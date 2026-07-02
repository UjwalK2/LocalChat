const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');

// In-memory track of active connections
// username -> set of socket IDs (a user can have multiple tabs open)
const activeConnections = new Map();

// username -> user metadata (display name, avatar color, status)
const onlineUsers = new Map();

function initSocket(io) {
  // Middleware to authenticate socket connections
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    
    if (!token) {
      return next(new Error('Authentication error: Token missing'));
    }

    try {
      const decoded = jwt.verify(token, config.JWT_SECRET);
      const user = await db.getUserByUsername(decoded.username);
      
      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }

      // Attach user details to the socket (safe details only)
      socket.user = {
        username: user.username,
        displayName: user.displayName,
        avatarColor: user.avatarColor,
        id: user.id
      };
      
      next();
    } catch (err) {
      return next(new Error('Authentication error: Invalid or expired token'));
    }
  });

  io.on('connection', async (socket) => {
    const { username, displayName, avatarColor } = socket.user;
    console.log(`Socket connected: ${username} (${socket.id})`);

    // 1. Manage connection tracking
    if (!activeConnections.has(username)) {
      activeConnections.set(username, new Set());
      onlineUsers.set(username, {
        username,
        displayName,
        avatarColor,
        status: 'online'
      });
    }
    activeConnections.get(username).add(socket.id);

    // Join a room unique to the user's username
    // This allows sending DMs or events directly to all tabs of a specific user
    await socket.join(`user_${username}`);
    
    // Always join the global room by default
    await socket.join('global');

    // Broadcast updated online user list to everyone
    io.emit('online_users_list', Array.from(onlineUsers.values()));

    // 2. Event Handlers

    // Get historical messages
    socket.on('get_history', async ({ to }, callback) => {
      try {
        let messages = [];
        if (to === 'global') {
          messages = await db.getMessages('global');
        } else {
          // It's a DM, fetch history between current user and the target user
          messages = await db.getMessages(username, to);
        }
        
        // Return via callback or event
        if (typeof callback === 'function') {
          callback({ success: true, messages });
        } else {
          socket.emit('message_history', { to, messages });
        }
      } catch (err) {
        console.error('Error fetching chat history:', err);
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Failed to fetch history' });
        }
      }
    });

    // Handle sending message
    socket.on('send_message', async ({ to, text }, callback) => {
      try {
        if (!text || text.trim() === '') {
          return;
        }

        const msgData = {
          from: username,
          senderName: displayName,
          to: to,
          text: text
        };

        const savedMsg = await db.createMessage(msgData);

        if (to === 'global') {
          // Send to everyone in the global room
          io.to('global').emit('new_message', savedMsg);
        } else {
          // Direct Message: Send to sender's own user room and target's user room
          // This updates all open tabs of both users
          io.to(`user_${username}`).to(`user_${to}`).emit('new_message', savedMsg);
        }

        if (typeof callback === 'function') {
          callback({ success: true, message: savedMsg });
        }
      } catch (err) {
        console.error('Error sending message:', err);
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Message delivery failed' });
        }
      }
    });

    // Handle typing indicators
    socket.on('typing', ({ to, isTyping }) => {
      if (to === 'global') {
        socket.to('global').emit('user_typing', {
          from: username,
          senderName: displayName,
          to: 'global',
          isTyping
        });
      } else {
        // Send typing status to the target user room
        socket.to(`user_${to}`).emit('user_typing', {
          from: username,
          senderName: displayName,
          to,
          isTyping
        });
      }
    });

    // Handle disconnecting
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${username} (${socket.id})`);
      
      const userSockets = activeConnections.get(username);
      if (userSockets) {
        userSockets.delete(socket.id);
        
        // If no more open connections/tabs for this user, mark offline
        if (userSockets.size === 0) {
          activeConnections.delete(username);
          onlineUsers.delete(username);
          
          // Broadcast updated online user list to everyone
          io.emit('online_users_list', Array.from(onlineUsers.values()));
        }
      }
    });
  });
}

module.exports = initSocket;

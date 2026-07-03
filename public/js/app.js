// App State Management
let currentUser = null;
let activeChat = 'global'; // 'global' or username of a target user
let onlineUsers = [];
let unreadMessages = {}; // username -> count
let socket = null;
let typingTimeout = null;

// DOM Elements
const authOverlay = document.getElementById('auth-overlay');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const showRegisterLink = document.getElementById('show-register');
const showLoginLink = document.getElementById('show-login');
const loginError = document.getElementById('login-error');
const registerError = document.getElementById('register-error');

const appShell = document.getElementById('app-shell');
const currentUserAvatar = document.getElementById('current-user-avatar');
const currentUserDisplay = document.getElementById('current-user-display');
const currentUserUsername = document.getElementById('current-user-username');
const activeUsersContainer = document.getElementById('active-users-container');
const logoutBtn = document.getElementById('logout-btn');

const sidebar = document.getElementById('app-sidebar');
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
const sidebarCloseBtn = document.getElementById('sidebar-close-btn');

const activeChatAvatar = document.getElementById('active-chat-avatar');
const activeChatTitle = document.getElementById('active-chat-title');
const activeChatStatus = document.getElementById('active-chat-status');
const messagesContainer = document.getElementById('messages-container');
const chatInputForm = document.getElementById('chat-input-form');
const messageInput = document.getElementById('message-input');
const typingIndicator = document.getElementById('typing-indicator');
const typingText = document.getElementById('typing-text');

const globalChannelBtn = document.getElementById('channel-global');
const globalBadge = document.getElementById('badge-global');

// 1. INITIALIZATION & SESSION HANDLERS
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupAuthEventListeners();
  setupUIEventListeners();
});

async function initApp() {
  const token = ApiService.getToken();
  if (token) {
    try {
      // Validate token with backend
      const data = await ApiService.getCurrentUser();
      currentUser = data.user;
      
      // Render App
      renderAppShell();
      connectWebSocket(token);
    } catch (err) {
      console.warn('Session invalid, clearing...', err);
      ApiService.clearSession();
      showAuthOverlay();
    }
  } else {
    showAuthOverlay();
  }
}

function showAuthOverlay() {
  authOverlay.classList.remove('hidden');
  appShell.classList.add('hidden');
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

function hideAuthOverlay() {
  authOverlay.classList.add('hidden');
  appShell.classList.remove('hidden');
}

// 2. AUTHENTICATION FLOW
function setupAuthEventListeners() {
  // Toggle forms
  showRegisterLink.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
    document.getElementById('auth-subtitle').textContent = 'Create a new account';
  });

  showLoginLink.addEventListener('click', (e) => {
    e.preventDefault();
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    document.getElementById('auth-subtitle').textContent = 'Sign in to start chatting';
  });

  // Handle Login
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    try {
      const data = await ApiService.login(username, password);
      ApiService.setSession(data.token, data.user);
      currentUser = data.user;
      
      hideAuthOverlay();
      renderAppShell();
      connectWebSocket(data.token);
      
      // Reset form fields
      loginForm.reset();
    } catch (err) {
      loginError.textContent = err.message || 'Login failed';
    }
  });

  // Handle Registration
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    registerError.textContent = '';
    const username = document.getElementById('register-username').value;
    const displayName = document.getElementById('register-displayname').value;
    const password = document.getElementById('register-password').value;

    try {
      const data = await ApiService.register(username, password, displayName);
      ApiService.setSession(data.token, data.user);
      currentUser = data.user;
      
      hideAuthOverlay();
      renderAppShell();
      connectWebSocket(data.token);
      
      // Reset form fields
      registerForm.reset();
    } catch (err) {
      registerError.textContent = err.message || 'Registration failed';
    }
  });

  // Handle Logout
  logoutBtn.addEventListener('click', () => {
    ApiService.clearSession();
    currentUser = null;
    activeChat = 'global';
    unreadMessages = {};
    showAuthOverlay();
  });
}

// Render User details in sidebar
function renderAppShell() {
  if (!currentUser) return;
  currentUserDisplay.textContent = currentUser.displayName;
  currentUserUsername.textContent = `@${currentUser.username}`;
  
  // Set avatar initials & color
  currentUserAvatar.textContent = currentUser.displayName[0].toUpperCase();
  currentUserAvatar.style.backgroundColor = currentUser.avatarColor;
  
  // Default active chat
  switchChat('global');
}

// 3. WEBSOCKET HANDLING
function connectWebSocket(token) {
  // Connect with token in handshake auth object
  socket = io({
    auth: { token }
  });

  socket.on('connect', () => {
    console.log('Connected to real-time chat server');
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err.message);
  });

  // Handle online user list updates
  socket.on('online_users_list', (users) => {
    // Filter out current user from listing
    onlineUsers = users.filter(u => u.username !== currentUser.username);
    renderOnlineUsers();
  });

  // Handle new message arrival
  socket.on('new_message', (msg) => {
    const isGlobalMsg = msg.to === 'global';
    
    // Check if this message belongs to currently active chat viewport
    if (activeChat === 'global' && isGlobalMsg) {
      appendMessage(msg);
      scrollToBottom();
    } else if (activeChat !== 'global' && !isGlobalMsg && 
              (msg.from === activeChat || msg.from === currentUser.username)) {
      appendMessage(msg);
      scrollToBottom();
    } else {
      // Message belongs to background room -> increment unread count badge
      const key = isGlobalMsg ? 'global' : msg.from;
      unreadMessages[key] = (unreadMessages[key] || 0) + 1;
      updateUnreadBadges();
    }
  });

  // Handle typing indicator broadcast
  socket.on('user_typing', ({ from, to, isTyping }) => {
    // Show typing only if from activeChat target
    if (to === 'global' && activeChat === 'global' && from !== currentUser.username) {
      showTypingIndicator(`${from} is typing...`, isTyping);
    } else if (to !== 'global' && activeChat === from) {
      showTypingIndicator(`${from} is typing...`, isTyping);
    }
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server');
  });
}

// 4. CHAT SWITCHING & LOADING HISTORY
function switchChat(chatId) {
  activeChat = chatId;
  
  // Update sidebar selection styling
  document.querySelectorAll('.channel-item, .user-item').forEach(el => {
    el.classList.remove('active');
  });
  
  if (chatId === 'global') {
    globalChannelBtn.classList.add('active');
    activeChatTitle.textContent = 'Global Chat';
    activeChatStatus.textContent = 'Join the conversations';
    
    activeChatAvatar.textContent = 'G';
    activeChatAvatar.style.backgroundColor = '#6366f1';
    
    // Clear unread badge
    unreadMessages['global'] = 0;
    updateUnreadBadges();
  } else {
    const targetUser = onlineUsers.find(u => u.username === chatId);
    const elementId = `user-item-${chatId}`;
    const userEl = document.getElementById(elementId);
    if (userEl) userEl.classList.add('active');

    const displayName = targetUser ? targetUser.displayName : chatId;
    const color = targetUser ? targetUser.avatarColor : '#6366f1';

    activeChatTitle.textContent = displayName;
    activeChatStatus.textContent = `@${chatId} (Online)`;
    
    activeChatAvatar.textContent = displayName[0].toUpperCase();
    activeChatAvatar.style.backgroundColor = color;
    
    // Clear unread badge
    unreadMessages[chatId] = 0;
    updateUnreadBadges();
  }

  // Clear typing indicator
  showTypingIndicator('', false);
  
  // Load chat history
  loadChatHistory(chatId);

  // Close sidebar drawer on mobile after selecting chat
  if (window.innerWidth <= 768) {
    sidebar.classList.remove('open');
  }
}

function loadChatHistory(chatId) {
  // Clear messages container
  messagesContainer.innerHTML = '';
  
  if (!socket) return;

  socket.emit('get_history', { to: chatId }, (res) => {
    if (res.success) {
      if (res.messages.length === 0) {
        renderWelcomeScreen(chatId);
      } else {
        res.messages.forEach(msg => appendMessage(msg));
        scrollToBottom();
      }
    } else {
      messagesContainer.innerHTML = `<div class="list-placeholder">Error loading messages history</div>`;
    }
  });
}

function renderWelcomeScreen(chatId) {
  const isGlobal = chatId === 'global';
  const targetName = isGlobal ? 'Global Chat' : `@${chatId}`;
  const desc = isGlobal 
    ? 'This room stores messages locally. Feel free to chat with anyone online.' 
    : `This is the beginning of your private chat history with ${targetName}.`;

  messagesContainer.innerHTML = `
    <div class="welcome-screen">
      <div class="welcome-graphic">${isGlobal ? '💬' : '🔒'}</div>
      <h2>${isGlobal ? 'Welcome to Global Chat!' : `Chatting with ${targetName}`}</h2>
      <p>${desc}</p>
    </div>
  `;
}

// 5. UI RENDERING UTILS
function renderOnlineUsers() {
  if (onlineUsers.length === 0) {
    activeUsersContainer.innerHTML = `<div class="list-placeholder">No other users online</div>`;
    return;
  }

  activeUsersContainer.innerHTML = '';
  onlineUsers.forEach(user => {
    const unreadCount = unreadMessages[user.username] || 0;
    const badgeHTML = unreadCount > 0 ? `<span class="badge" id="badge-${user.username}">${unreadCount}</span>` : `<span class="badge hidden" id="badge-${user.username}">0</span>`;

    const userBtn = document.createElement('button');
    userBtn.className = `user-item ${activeChat === user.username ? 'active' : ''}`;
    userBtn.id = `user-item-${user.username}`;
    userBtn.innerHTML = `
      <div class="avatar" style="background-color: ${user.avatarColor}">${user.displayName[0].toUpperCase()}</div>
      <span class="user-item-name">${user.displayName}</span>
      ${badgeHTML}
      <span class="user-status-dot online"></span>
    `;

    userBtn.addEventListener('click', () => {
      switchChat(user.username);
    });

    activeUsersContainer.appendChild(userBtn);
  });

  // If currently in a DM with a user who is no longer online, change header state to offline
  if (activeChat !== 'global') {
    const stillOnline = onlineUsers.some(u => u.username === activeChat);
    if (!stillOnline) {
      activeChatStatus.textContent = `@${activeChat} (Offline)`;
    }
  }
}

function updateUnreadBadges() {
  // Global badge
  const globalUnread = unreadMessages['global'] || 0;
  if (globalUnread > 0) {
    globalBadge.textContent = globalUnread;
    globalBadge.classList.remove('hidden');
  } else {
    globalBadge.classList.add('hidden');
  }

  // Users badges
  onlineUsers.forEach(user => {
    const count = unreadMessages[user.username] || 0;
    const badgeEl = document.getElementById(`badge-${user.username}`);
    if (badgeEl) {
      if (count > 0) {
        badgeEl.textContent = count;
        badgeEl.classList.remove('hidden');
      } else {
        badgeEl.classList.add('hidden');
      }
    }
  });
}

function appendMessage(msg) {
  // Remove welcome screen if present
  const welcome = messagesContainer.querySelector('.welcome-screen');
  if (welcome) {
    messagesContainer.removeChild(welcome);
  }

  const isOutgoing = msg.from === currentUser.username;
  
  // Format Timestamp
  const dateObj = new Date(msg.timestamp);
  const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Get user avatar details (from active list or self)
  let avatarColor = '#6366f1';
  let initial = msg.senderName[0].toUpperCase();

  if (isOutgoing) {
    avatarColor = currentUser.avatarColor;
  } else {
    const senderObj = onlineUsers.find(u => u.username === msg.from);
    if (senderObj) {
      avatarColor = senderObj.avatarColor;
    }
  }

  const messageWrapper = document.createElement('div');
  messageWrapper.className = `message-wrapper ${isOutgoing ? 'outgoing' : 'incoming'}`;
  
  messageWrapper.innerHTML = `
    <div class="avatar" style="background-color: ${avatarColor}">${initial}</div>
    <div class="message-bubble-container">
      <div class="message-meta">
        <span class="message-sender">${isOutgoing ? 'You' : msg.senderName}</span>
        <span class="message-time">${timeStr}</span>
      </div>
      <div class="message-bubble">${escapeHTML(msg.text)}</div>
    </div>
  `;

  messagesContainer.appendChild(messageWrapper);
}

function showTypingIndicator(text, isTyping) {
  if (isTyping) {
    typingText.textContent = text;
    typingIndicator.classList.remove('hidden');
  } else {
    typingIndicator.classList.add('hidden');
  }
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// 6. EVENT INTERACTION (SEND & TYPING ACTIONS)
function setupUIEventListeners() {
  // Mobile sidebar burger / close
  sidebarToggleBtn.addEventListener('click', () => {
    sidebar.classList.add('open');
  });

  sidebarCloseBtn.addEventListener('click', () => {
    sidebar.classList.remove('open');
  });

  // Global Chat list click
  globalChannelBtn.addEventListener('click', () => {
    switchChat('global');
  });

  // Chat Submission Form
  chatInputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !socket) return;

    // Send to WebSocket server
    socket.emit('send_message', { to: activeChat, text }, (res) => {
      if (res && !res.success) {
        alert(res.error || 'Failed to send message');
      }
    });

    messageInput.value = '';
    messageInput.focus();

    // Signal typing has stopped
    socket.emit('typing', { to: activeChat, isTyping: false });
    if (typingTimeout) clearTimeout(typingTimeout);
  });

  // Input Typing Indicators listener
  messageInput.addEventListener('input', () => {
    if (!socket) return;

    // Emit user started typing
    socket.emit('typing', { to: activeChat, isTyping: true });

    // Clear previous timeout and set new debounce
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      socket.emit('typing', { to: activeChat, isTyping: false });
    }, 2000);
  });
}

// Escapes raw message strings to prevent XSS injection
function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

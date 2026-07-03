const fs = require('fs').promises;
const path = require('path');
const config = require('./config');

// In-memory cache of the database
let dbCache = {
  users: {},    // Map of username -> user object
  messages: []  // Array of all messages
};

let dbInitialized = false;

// Ensure database file and directories exist, and load cache
async function init() {
  if (dbInitialized) return;

  const dbDir = path.dirname(config.DB_PATH);
  
  try {
    await fs.mkdir(dbDir, { recursive: true });
  } catch (err) {
    console.error('Error creating database directory:', err);
  }

  try {
    const data = await fs.readFile(config.DB_PATH, 'utf8');
    dbCache = JSON.parse(data);
    
    // Ensure structure is correct
    if (!dbCache.users) dbCache.users = {};
    if (!dbCache.messages) dbCache.messages = [];
    
    console.log(`Database loaded successfully. Loaded ${Object.keys(dbCache.users).length} users and ${dbCache.messages.length} messages.`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('No database file found. Initializing new database...');
      await save();
    } else {
      console.error('Error reading database file, starting with empty database:', err);
    }
  }
  
  dbInitialized = true;
}

// Atomic save function: writes to temp file first, then renames
async function save() {
  const tempPath = `${config.DB_PATH}.tmp`;
  try {
    const jsonString = JSON.stringify(dbCache, null, 2);
    await fs.writeFile(tempPath, jsonString, 'utf8');
    await fs.rename(tempPath, config.DB_PATH);
  } catch (err) {
    console.error('Critical database write error:', err);
    throw err;
  }
}

// Database Helpers
const db = {
  async init() {
    await init();
  },

  async getUserByUsername(username) {
    await init();
    const key = username.toLowerCase();
    return dbCache.users[key] || null;
  },

  async getUserById(id) {
    await init();
    return Object.values(dbCache.users).find(u => u.id === id) || null;
  },

  async createUser(user) {
    await init();
    const key = user.username.toLowerCase();
    dbCache.users[key] = {
      id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      username: user.username,
      displayName: user.displayName || user.username,
      passwordHash: user.passwordHash,
      avatarColor: user.avatarColor || '#6366f1', // default indigo
      createdAt: new Date().toISOString()
    };
    await save();
    return dbCache.users[key];
  },

  async getAllUsers() {
    await init();
    // Return all users stripped of password hash
    return Object.values(dbCache.users).map(({ passwordHash, ...user }) => user);
  },

  async createMessage(msg) {
    await init();
    const message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      from: msg.from,         // username
      to: msg.to,             // username or 'global'
      text: msg.text,
      timestamp: new Date().toISOString(),
      senderName: msg.senderName
    };
    dbCache.messages.push(message);
    await save();
    return message;
  },

  async getMessages(roomOrUser1, user2 = null) {
    await init();
    if (roomOrUser1 === 'global' && !user2) {
      // Get all global messages
      return dbCache.messages.filter(m => m.to === 'global');
    }
    
    if (roomOrUser1 && user2) {
      // Get DM history between user1 and user2 (case-insensitive username check)
      const u1 = roomOrUser1.toLowerCase();
      const u2 = user2.toLowerCase();
      return dbCache.messages.filter(m => 
        (m.from.toLowerCase() === u1 && m.to.toLowerCase() === u2) ||
        (m.from.toLowerCase() === u2 && m.to.toLowerCase() === u1)
      );
    }
    
    return [];
  }
};

module.exports = db;

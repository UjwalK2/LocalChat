const path = require('path');

module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'local-chat-secret-key-1234567890',
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '../data/db.json'),
  JWT_EXPIRY: '7d'
};

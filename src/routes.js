const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const db = require('./db');
const config = require('./config');

const router = express.Router();

// Middleware to authenticate JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[2]; // Bearer <token> or Token <token> or just Bearer <token>
  // Let's support both standard forms: "Bearer <token>" and simply token from headers
  let parsedToken = token;
  if (!parsedToken && authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      parsedToken = parts[1];
    } else {
      parsedToken = authHeader; // fallback
    }
  }

  if (!parsedToken) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(parsedToken, config.JWT_SECRET, async (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    
    const user = await db.getUserByUsername(decoded.username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Strip password hash
    const { passwordHash, ...safeUser } = user;
    req.user = safeUser;
    next();
  });
}

// Generate JWT Helper
function generateToken(username) {
  return jwt.sign({ username }, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRY });
}

// Color palettes for avatars (modern, high contrast, aesthetic dark theme colors)
const AVATAR_COLORS = [
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#3b82f6', // Blue
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#06b6d4', // Cyan
  '#14b8a6'  // Teal
];

function getRandomColor() {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

// Auth API Endpoints

// REGISTER
router.post('/auth/register', async (req, res) => {
  try {
    const { username, password, displayName } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const cleanUsername = username.trim();
    if (cleanUsername.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters long' });
    }
    
    if (password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters long' });
    }

    const existingUser = await db.getUserByUsername(cleanUsername);
    if (existingUser) {
      return res.status(400).json({ error: 'Username is already taken' });
    }

    // Hash the password with bcryptjs
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const avatarColor = getRandomColor();
    const newUser = await db.createUser({
      username: cleanUsername,
      displayName: (displayName && displayName.trim()) || cleanUsername,
      passwordHash,
      avatarColor
    });

    const token = generateToken(newUser.username);

    // Strip password hash before sending response
    const { passwordHash: _, ...safeUser } = newUser;

    return res.status(201).json({
      message: 'Registration successful',
      token,
      user: safeUser
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error during registration' });
  }
});

// LOGIN
router.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await db.getUserByUsername(username.trim());
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = generateToken(user.username);
    const { passwordHash: _, ...safeUser } = user;

    return res.json({
      message: 'Login successful',
      token,
      user: safeUser
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error during login' });
  }
});

// GET CURRENT USER PROFILE
router.get('/auth/me', authenticateToken, (req, res) => {
  return res.json({ user: req.user });
});

// Multer storage config for media uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../public/media'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${uniqueSuffix}-${sanitizedName}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB file size limit
});

// POST /api/media/upload API
router.post('/media/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { to } = req.body;
    if (!to) {
      return res.status(400).json({ error: 'Recipient room or user (to) is required' });
    }

    const username = req.user.username;
    const displayName = req.user.displayName;
    
    // 1. Prepare metadata
    const fileMetadata = {
      originalName: req.file.originalname,
      filename: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
      uploadedBy: username,
      senderName: displayName,
      roomId: to,
      uploadedAt: new Date().toISOString()
    };

    // 2. Save metadata JSON file alongside the uploaded file
    const metaFilePath = path.join(__dirname, '../public/media', `${req.file.filename}.json`);
    await fs.writeFile(metaFilePath, JSON.stringify(fileMetadata, null, 2), 'utf8');

    // 3. Create the database message containing the file info
    const messageData = {
      from: username,
      senderName: displayName,
      to: to,
      text: `Sent a file: ${req.file.originalname}`,
      file: {
        originalName: req.file.originalname,
        filename: req.file.filename,
        mimeType: req.file.mimetype,
        size: req.file.size,
        path: `/media/${req.file.filename}`
      }
    };

    const savedMsg = await db.createMessage(messageData);

    // 4. Broadcast the message to participants via Socket.io
    const io = req.app.get('io');
    if (io) {
      if (to === 'global') {
        io.to('global').emit('new_message', savedMsg);
      } else {
        io.to(`user_${username}`).to(`user_${to}`).emit('new_message', savedMsg);
      }
    }

    return res.status(201).json({
      message: 'File uploaded successfully',
      chatMessage: savedMsg
    });

  } catch (error) {
    console.error('File upload error:', error);
    return res.status(500).json({ error: 'Internal server error during file upload' });
  }
});

module.exports = {
  router,
  authenticateToken
};

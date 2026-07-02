const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const db = require('./db');
const { router: authRouter } = require('./routes');
const initSocket = require('./socket');

async function startServer() {
  try {
    // 1. Initialize the local database file
    await db.init();

    // 2. Set up Express application
    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Serve static files from the public folder
    app.use(express.static(path.join(__dirname, '../public')));

    // Mount Auth APIs
    app.use('/api', authRouter);

    // Default route for SPA routing support (fallback to index.html)
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });

    // 3. Set up HTTP and Socket.io server
    const server = http.createServer(app);
    const io = socketIo(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    // Initialize real-time WebSocket event listeners
    initSocket(io);

    // 4. Start listening (bind to 0.0.0.0 to allow access from local network, android, termux etc.)
    const host = '0.0.0.0';
    server.listen(config.PORT, host, () => {
      console.log('==================================================');
      console.log(`Local Chatroom Server is running!`);
      console.log(`- Local Access:     http://localhost:${config.PORT}`);
      console.log(`- Network Access:   http://<YOUR_IP_ADDRESS>:${config.PORT}`);
      console.log(`Running on platform: ${process.platform}`);
      console.log('==================================================');
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

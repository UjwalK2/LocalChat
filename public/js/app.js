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

// Attachment and Modal Elements
const btnAttach = document.getElementById('btn-attach');
const mediaFileInput = document.getElementById('media-file-input');
const mediaModal = document.getElementById('media-modal');
const mediaModalClose = document.getElementById('media-modal-close');
const mediaModalBackdrop = document.getElementById('media-modal-backdrop');
const mediaModalContent = document.getElementById('media-modal-content');
const mediaModalFilename = document.getElementById('media-modal-filename');
const mediaModalDetails = document.getElementById('media-modal-details');

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
  
  let bubbleContent = '';
  if (msg.file) {
    const file = msg.file;
    const isImage = file.mimeType.startsWith('image/');
    const isVideo = file.mimeType.startsWith('video/');
    const isAudio = file.mimeType.startsWith('audio/');
    const formattedSize = formatBytes(file.size);
    const escapedName = escapeHTML(file.originalName);
    const escapedPath = escapeHTML(file.path);
    const escapedMime = escapeHTML(file.mimeType);
    const escapedSender = escapeHTML(msg.senderName);

    if (isImage) {
      bubbleContent = `
        <div class="media-preview-container image-preview">
          <img src="${escapedPath}" alt="${escapedName}" class="chat-media-preview-img" 
               data-src="${escapedPath}" data-name="${escapedName}" data-size="${file.size}" data-sender="${escapedSender}" data-mime="${escapedMime}">
        </div>
      `;
    } else if (isVideo) {
      bubbleContent = `
        <div class="media-preview-container video-preview">
          <video class="chat-media-preview-video" 
                 data-src="${escapedPath}" data-name="${escapedName}" data-size="${file.size}" data-sender="${escapedSender}" data-mime="${escapedMime}">
            <source src="${escapedPath}" type="${escapedMime}">
          </video>
          <div class="video-play-overlay">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </div>
        </div>
      `;
    } else if (isAudio) {
      bubbleContent = `
        <div class="media-preview-container audio-preview">
          <audio controls src="${escapedPath}"></audio>
        </div>
      `;
    } else {
      const fileIcon = getFileIcon(file.mimeType);
      bubbleContent = `
        <a href="${escapedPath}" download="${escapedName}" class="file-card">
          <div class="file-card-icon">${fileIcon}</div>
          <div class="file-card-info">
            <span class="file-card-name">${escapedName}</span>
            <span class="file-card-size">${formattedSize}</span>
          </div>
          <div class="file-card-download-btn">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </div>
        </a>
      `;
    }
  } else {
    bubbleContent = escapeHTML(msg.text);
  }

  messageWrapper.innerHTML = `
    <div class="avatar" style="background-color: ${avatarColor}">${initial}</div>
    <div class="message-bubble-container">
      <div class="message-meta">
        <span class="message-sender">${isOutgoing ? 'You' : msg.senderName}</span>
        <span class="message-time">${timeStr}</span>
      </div>
      <div class="message-bubble">${bubbleContent}</div>
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

  // Attach File Button click handler
  btnAttach.addEventListener('click', () => {
    mediaFileInput.click();
  });

  // Handle File upload input change
  mediaFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      handleFileUpload(file);
    }
    mediaFileInput.value = '';
  });

  // Media Modal close button and backdrop click
  mediaModalClose.addEventListener('click', closeMediaModal);
  mediaModalBackdrop.addEventListener('click', closeMediaModal);

  // Close media modal on Escape key press
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !mediaModal.classList.contains('hidden')) {
      closeMediaModal();
    }
  });

  // Click delegation to detect clicks on image/video thumbnails and show the modal
  messagesContainer.addEventListener('click', (e) => {
    const imgEl = e.target.closest('.chat-media-preview-img');
    const videoPreviewEl = e.target.closest('.video-preview');

    if (imgEl) {
      const src = imgEl.getAttribute('data-src');
      const name = imgEl.getAttribute('data-name');
      const size = parseInt(imgEl.getAttribute('data-size'), 10);
      const sender = imgEl.getAttribute('data-sender');
      const mime = imgEl.getAttribute('data-mime');
      openMediaModal(src, mime, name, size, sender);
    } else if (videoPreviewEl) {
      const videoEl = videoPreviewEl.querySelector('.chat-media-preview-video');
      if (videoEl) {
        const src = videoEl.getAttribute('data-src');
        const name = videoEl.getAttribute('data-name');
        const size = parseInt(videoEl.getAttribute('data-size'), 10);
        const sender = videoEl.getAttribute('data-sender');
        const mime = videoEl.getAttribute('data-mime');
        openMediaModal(src, mime, name, size, sender);
      }
    }
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

// Format file sizes into human-readable strings
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Get modern file emojis depending on the document MIME type
function getFileIcon(mimeType) {
  if (mimeType.includes('pdf')) return '📕';
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('tar')) return '📦';
  if (mimeType.includes('text') || mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('excel') || mimeType.includes('sheet') || mimeType.includes('csv')) return '📊';
  return '📁';
}

// Handle client-side file upload logic
async function handleFileUpload(file) {
  if (!socket) return;
  
  // 1. Create a dummy outgoing message for the uploading state
  const tempId = `upload_${Date.now()}`;
  appendUploadingPlaceholder(tempId, file.name);
  scrollToBottom();

  const formData = new FormData();
  formData.append('file', file);
  formData.append('to', activeChat);

  try {
    const token = ApiService.getToken();
    const response = await fetch('/api/media/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    const data = await response.json();
    
    // Remove the placeholder card
    removeUploadingPlaceholder(tempId);

    if (!response.ok) {
      alert(data.error || 'Failed to upload file');
    }
  } catch (err) {
    console.error('Upload failed:', err);
    removeUploadingPlaceholder(tempId);
    alert('Upload failed: ' + err.message);
  }
}

// Append a temporary uploading card in the message container
function appendUploadingPlaceholder(tempId, fileName) {
  const welcome = messagesContainer.querySelector('.welcome-screen');
  if (welcome) {
    messagesContainer.removeChild(welcome);
  }

  const messageWrapper = document.createElement('div');
  messageWrapper.className = 'message-wrapper outgoing';
  messageWrapper.id = tempId;
  
  const avatarColor = currentUser.avatarColor;
  const initial = currentUser.displayName[0].toUpperCase();

  messageWrapper.innerHTML = `
    <div class="avatar" style="background-color: ${avatarColor}">${initial}</div>
    <div class="message-bubble-container">
      <div class="message-meta">
        <span class="message-sender">You</span>
        <span class="message-time">Uploading...</span>
      </div>
      <div class="message-bubble" style="background: rgba(99, 102, 241, 0.35); border-top-right-radius: 4px;">
        <div class="uploading-card">
          <div class="uploading-spinner"></div>
          <div class="uploading-info">
            <span class="uploading-title">Uploading file...</span>
            <span class="file-card-size" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">${fileName}</span>
          </div>
        </div>
      </div>
    </div>
  `;

  messagesContainer.appendChild(messageWrapper);
}

// Remove uploading card placeholder when request finishes
function removeUploadingPlaceholder(tempId) {
  const el = document.getElementById(tempId);
  if (el) {
    messagesContainer.removeChild(el);
  }
}

// Open fullscreen glassmorphic media modal with image/video
function openMediaModal(src, mime, name, size, sender) {
  mediaModalContent.innerHTML = '';
  
  if (mime.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = name;
    mediaModalContent.appendChild(img);
  } else if (mime.startsWith('video/')) {
    const video = document.createElement('video');
    video.src = src;
    video.controls = true;
    video.autoplay = true;
    mediaModalContent.appendChild(video);
  }

  mediaModalFilename.textContent = name;
  mediaModalDetails.textContent = `${formatBytes(size)} • Sent by ${sender}`;
  
  mediaModal.classList.remove('hidden');
}

// Close the media modal and clean up playback
function closeMediaModal() {
  mediaModal.classList.add('hidden');
  const video = mediaModalContent.querySelector('video');
  if (video) {
    video.pause();
  }
}

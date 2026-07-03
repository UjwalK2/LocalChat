# ⚡ LocalChat

A highly portable, dark-themed, file-persisted local network chatroom application. It runs on any platform supporting Node.js, including Android (via Termux), Windows, macOS, and Linux.

## ✨ Features

-   **Zero Native Compilations**: Uses `bcryptjs` for security and a custom local JSON database. It can be installed instantly on mobile chips (e.g., Termux) without native build tools.
-   **Dark & Practical UI**: Clean responsive interface featuring glassmorphic forms, glowing user status dots, custom scrollbars, and sidebar drawers designed for both desktop and mobile viewports.
-   **Persistent Messaging**: Messages and user credentials are saved locally in a single file database (`data/db.json`) with safe atomic write guards.
-   **Global & Private Chat**: Toggle between a public Global Chatroom and 1-on-1 private messaging (DMs) with unread notification badges.
-   **Real-time Interaction**: Instant text delivery, active online lists, and typing indicators using WebSockets (Socket.io).

## 🚀 Easy Setup

### Prerequisites
-   [Node.js](https://nodejs.org/) (v16+)

### Installation

1.  **Install dependencies**:
    ```bash
    npm install
    ```

2.  **Start the server**:
    ```bash
    npm start
    ```

3.  **Access the application**:
    -   **Local Access**: Open `http://localhost:3000` in your web browser.
    -   **Network Access**: Since the server binds to `0.0.0.0`, other devices on the same Wi-Fi network can join by opening `http://<YOUR_IP_ADDRESS>:3000`.

---

## 📱 Running on Android Termux

1.  Install the **Termux** app on your Android device (prefer F-Droid release).
2.  Update Termux environment and install Node.js:
    ```bash
    pkg update && pkg upgrade -y
    pkg install nodejs -y
    ```
3.  Copy this folder to your Termux directory, then run:
    ```bash
    npm install
    npm start
    ```
4.  Open `http://localhost:3000` on your phone's browser or connect from a computer on the same network using your phone's local IP address.

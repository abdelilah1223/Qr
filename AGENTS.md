## Running the WebRTC Video/Audio Call Application

This project implements a simple WebRTC video and audio calling website with a Node.js signaling server.

### Prerequisites

*   Node.js and npm: Make sure you have Node.js installed, which includes npm (Node Package Manager).

### Server Setup

1.  **Install Dependencies:**
    Navigate to the project root directory in your terminal and run:
    ```bash
    npm install
    ```
    This will install the necessary dependencies (`ws` and `uuid`) defined in `package.json`.

2.  **Start the Signaling Server:**
    After installing dependencies, you can start the signaling server using:
    ```bash
    npm start
    ```
    Alternatively, you can run `node server.js`.
    The server will start and be accessible via HTTP (e.g., `http://localhost:8080`) and WebSockets on the same port.
    You should see log messages like:
    `Server running on http://localhost:8080`
    `WebSocket server is also attached and listening on port 8080`

### Accessing the Application

1.  **Open in Browser:**
    After starting the server, open a web browser (Chrome or Firefox are recommended for good WebRTC support).
2.  **Navigate to Server Address:**
    Navigate to the address of the running Node.js server. If it's running locally on the default port, this will be:
    `http://localhost:8080`
    The `server.js` script now directly serves the `index.html` page and other client assets (`app.js`, `style.css`). You no longer need a separate HTTP server for the client files.

### How to Use

1.  **Your ID:** When you open the application, your unique ID (assigned by the signaling server) will be displayed at the top.
2.  **Calling a Specific User:**
    *   Open the application in two browser windows/tabs.
    *   Note the ID from one window (e.g., User A).
    *   In the other window (User B), enter User A's ID into the "Enter Peer ID to call" field and click "Call".
3.  **Random Call:**
    *   Open the application in two or more browser windows/tabs.
    *   In each window you want to join a random call, click the "Random Call" button.
    *   If another user is also waiting or requests a random call, the server will attempt to pair you.
4.  **During a Call:**
    *   You should see your local video and the remote user's video.
    *   Audio should also be transmitted.
    *   Click "Hang Up" to end the call.

### Notes for Agent

*   The `server.js` now handles both HTTP static file serving (for `index.html`, `app.js`, `style.css`) and WebSocket signaling. It does not use a database, storing user sessions in memory.
*   `app.js` contains all client-side WebRTC and signaling logic. The WebSocket URL in `app.js` is now dynamically constructed to connect to the same host and port that served the HTTP files.
*   The application uses STUN servers from Google for NAT traversal. For more robust connections, especially across complex networks, a TURN server might be needed (not included in this setup).

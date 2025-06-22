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
    The server will start on `ws://localhost:8080` by default. You should see a log message: `Signaling server started on port 8080`.

### Client Setup

1.  **Serve Client Files:**
    The client-side files (`index.html`, `app.js`, `style.css`) need to be served by a simple HTTP server. You can use various tools for this, for example:
    *   **Using Python:** If you have Python installed, navigate to the project root and run:
        *   Python 3: `python -m http.server`
        *   Python 2: `python -m SimpleHTTPServer`
        This will typically serve files on `http://localhost:8000`.
    *   **Using VS Code Live Server:** If you are using Visual Studio Code, the "Live Server" extension is a convenient way to serve the files.
    *   Other HTTP server tools can also be used.

2.  **Access the Application:**
    Open a web browser (Chrome or Firefox are recommended for good WebRTC support) and navigate to the address where the client files are being served (e.g., `http://localhost:8000` if using Python's http.server on the default port).

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

*   The `server.js` handles signaling and does not use a database, storing user sessions in memory.
*   `app.js` contains all client-side WebRTC and signaling logic.
*   Ensure the WebSocket server (default `ws://localhost:8080`) is accessible to the client. If you change the server port or run it on a different machine, update the `wsUrl` in `app.js` accordingly.
*   The application uses STUN servers from Google for NAT traversal. For more robust connections, especially across complex networks, a TURN server might be needed (not included in this setup).

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ✅ Serve index.html from the same directory
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// In-memory connected users
const connectedUsers = new Map();

wss.on('connection', (ws) => {
  const userId = uuidv4();
  connectedUsers.set(userId, ws);

  ws.send(JSON.stringify({
    type: 'your-id',
    userId: userId
  }));

  ws.on('message', (message) => {
    const data = JSON.parse(message);

    switch (data.type) {
      case 'random-connect':
        handleRandomConnect(userId, ws);
        break;
      case 'connect-to':
        handleConnectTo(userId, data.targetId, ws);
        break;
      case 'webrtc-offer':
      case 'webrtc-answer':
      case 'ice-candidate':
        forwardMessage(data.targetId, message);
        break;
      case 'end-call': // معالجة خاصة لـ end-call
        if (data.targetId) {
          forwardMessage(data.targetId, JSON.stringify({ type: 'end-call' }));
        }
        break;
    }
  });

  ws.on('close', () => {
    connectedUsers.delete(userId);
  });
});

function handleRandomConnect(userId, ws) {
  const otherUsers = Array.from(connectedUsers.keys()).filter(id => id !== userId);

  if (otherUsers.length === 0) {
    ws.send(JSON.stringify({ type: 'no-users' }));
    return;
  }

  const randomUser = otherUsers[Math.floor(Math.random() * otherUsers.length)];
  initiateConnection(userId, randomUser, ws);
}

function handleConnectTo(userId, targetId, ws) {
  if (!connectedUsers.has(targetId)) {
    ws.send(JSON.stringify({ type: 'user-not-found' }));
    return;
  }

  initiateConnection(userId, targetId, ws);
}

function initiateConnection(callerId, calleeId, callerWs) {
  const calleeWs = connectedUsers.get(calleeId);

  callerWs.send(JSON.stringify({
    type: 'initiate-call',
    targetId: calleeId,
    isCaller: true
  }));

  calleeWs.send(JSON.stringify({
    type: 'initiate-call',
    targetId: callerId,
    isCaller: false
  }));
}

function forwardMessage(targetId, message) {
  if (connectedUsers.has(targetId)) {
    connectedUsers.get(targetId).send(message);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
  

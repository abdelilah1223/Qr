const express = require('express');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// تخزين المستخدمين المتصلين في الذاكرة
const connectedUsers = new Map();

// خدمة الملفات الثابتة
app.use(express.static('public'));

wss.on('connection', (ws) => {
    const userId = uuidv4();
    connectedUsers.set(userId, ws);
    
    // إرسال ID للمستخدم الجديد
    ws.send(JSON.stringify({
        type: 'your-id',
        userId: userId
    }));

    // معالجة الرسائل الواردة من المستخدم
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        switch(data.type) {
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
            case 'end-call':
                forwardMessage(data.targetId, message);
                break;
        }
    });

    // تنظيف عند انفصال المستخدم
    ws.on('close', () => {
        connectedUsers.delete(userId);
        // يمكن إرسال إشعار للمستخدمين المتصلين بهذا المستخدم
    });
});

function handleRandomConnect(userId, ws) {
    // البحث عن مستخدم آخر غير نفسه
    const otherUsers = Array.from(connectedUsers.keys()).filter(id => id !== userId);
    
    if (otherUsers.length === 0) {
        ws.send(JSON.stringify({
            type: 'no-users'
        }));
        return;
    }
    
    const randomUser = otherUsers[Math.floor(Math.random() * otherUsers.length)];
    initiateConnection(userId, randomUser, ws);
}

function handleConnectTo(userId, targetId, ws) {
    if (!connectedUsers.has(targetId)) {
        ws.send(JSON.stringify({
            type: 'user-not-found'
        }));
        return;
    }
    
    initiateConnection(userId, targetId, ws);
}

function initiateConnection(callerId, calleeId, callerWs) {
    const calleeWs = connectedUsers.get(calleeId);
    
    // إعلام الطرفين بالبدء
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
    console.log(`Server running on port ${PORT}`);
});

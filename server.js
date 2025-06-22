const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const wss = new WebSocket.Server({ port: 8080 });

// Store connected users: ws -> { id, peerId (current peer in call) }
const users = new Map();
// Store users waiting for a random call: id -> ws
const randomQueue = new Map();

console.log('Signaling server started on port 8080');

wss.on('connection', (ws) => {
    const userId = uuidv4();
    users.set(ws, { id: userId, peerId: null });
    console.log(`User ${userId} connected.`);

    // Send the user their ID
    ws.send(JSON.stringify({ type: 'your-id', id: userId }));

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            console.error('Failed to parse message:', message, e);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON message received.' }));
            return;
        }

        const currentUser = users.get(ws);
        if (!currentUser) {
            console.error('Received message from unknown WebSocket connection.');
            return;
        }
        const currentUserId = currentUser.id;

        console.log(`Message from ${currentUserId}:`, data);

        switch (data.type) {
            case 'offer':
            case 'answer':
            case 'candidate':
            case 'hangup':
                const targetUserWs = findUserById(data.to);
                if (targetUserWs) {
                    // Forward the message, adding 'from' field
                    const messageToSend = { ...data, from: currentUserId };
                    // If it's an offer, set the peerId for both users
                    if (data.type === 'offer') {
                        const targetUserDetails = users.get(targetUserWs);
                        if (targetUserDetails) {
                            currentUser.peerId = data.to;
                            targetUserDetails.peerId = currentUserId;
                            users.set(ws, currentUser);
                            users.set(targetUserWs, targetUserDetails);
                            console.log(`Call initiated between ${currentUserId} and ${data.to}`);
                        }
                    }
                     // If it's a hangup, clear peerIds
                    if (data.type === 'hangup') {
                        clearPeerInfo(ws, targetUserWs);
                        console.log(`Call ended between ${currentUserId} and ${data.to} by ${currentUserId}`);
                    }
                    targetUserWs.send(JSON.stringify(messageToSend));
                } else {
                    console.log(`User ${data.to} not found for message type ${data.type}.`);
                    if (data.type === 'offer') {
                        ws.send(JSON.stringify({ type: 'call-failed', message: `User ${data.to} is not online or does not exist.` }));
                    }
                }
                break;

            case 'request-random-peer':
                console.log(`User ${currentUserId} requests a random peer.`);
                // Check if there's anyone else in the queue
                if (randomQueue.size > 0) {
                    const [peerId, peerWs] = randomQueue.entries().next().value; // Get the first waiting user

                    if (peerId === currentUserId) { // Shouldn't happen if logic is correct
                        console.log("Random peer is self, re-queuing.");
                        // If somehow it's the same user, put them back if not already there, or just wait for next
                        if (!randomQueue.has(currentUserId)) randomQueue.set(currentUserId, ws);
                        return;
                    }

                    randomQueue.delete(peerId); // Remove peer from queue

                    // Initiate call by sending peer's stored offer (if we were to store it)
                    // Or, more simply, tell one to make an offer to the other.
                    // Let the current requester make an offer to the found peer.

                    // Update peerIds for both
                    const peerUserDetails = users.get(peerWs);
                    if (peerUserDetails) {
                        currentUser.peerId = peerId;
                        peerUserDetails.peerId = currentUserId;
                        users.set(ws, currentUser);
                        users.set(peerWs, peerUserDetails);
                    }

                    // Tell the requester to make an offer to the peer
                    ws.send(JSON.stringify({ type: 'make-offer-to', peerId: peerId }));
                    // Tell the peer to expect an offer from the requester
                    peerWs.send(JSON.stringify({ type: 'expect-offer-from', peerId: currentUserId }));

                    console.log(`Pairing ${currentUserId} with random peer ${peerId}`);

                } else {
                    // Add user to the random queue
                    randomQueue.set(currentUserId, ws);
                    console.log(`User ${currentUserId} added to random queue. Queue size: ${randomQueue.size}`);
                    ws.send(JSON.stringify({ type: 'no-random-peer', message: 'Waiting for another user to join for a random call.' }));
                }
                break;

            default:
                console.log(`Unknown message type: ${data.type}`);
                ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${data.type}` }));
        }
    });

    ws.on('close', () => {
        const closedUser = users.get(ws);
        if (closedUser) {
            console.log(`User ${closedUser.id} disconnected.`);
            const peerWs = findUserById(closedUser.peerId);
            if (peerWs) {
                peerWs.send(JSON.stringify({ type: 'user-left', from: closedUser.id }));
                clearPeerInfo(ws, peerWs);
            }
            users.delete(ws);
            if (randomQueue.has(closedUser.id)) {
                randomQueue.delete(closedUser.id);
                console.log(`User ${closedUser.id} removed from random queue.`);
            }
        }
    });

    ws.on('error', (error) => {
        const errorUser = users.get(ws);
        console.error(`WebSocket error for user ${errorUser ? errorUser.id : 'unknown'}:`, error);
        // Handle cleanup similar to 'close' if necessary, though 'close' usually follows.
    });
});

function findUserById(userId) {
    if (!userId) return null;
    for (const [clientWs, clientDetails] of users.entries()) {
        if (clientDetails.id === userId) {
            return clientWs;
        }
    }
    return null;
}

function clearPeerInfo(ws1, ws2) {
    const user1Details = users.get(ws1);
    if (user1Details) {
        user1Details.peerId = null;
        users.set(ws1, user1Details);
    }
    if (ws2) { // ws2 might be null if peer was not found or already disconnected
        const user2Details = users.get(ws2);
        if (user2Details) {
            user2Details.peerId = null;
            users.set(ws2, user2Details);
        }
    }
}

// Periodically log queue size for debugging
setInterval(() => {
    if (randomQueue.size > 0) {
        console.log(`Current random queue size: ${randomQueue.size}. Users: ${Array.from(randomQueue.keys())}`);
    }
}, 30000);

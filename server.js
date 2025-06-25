const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

// Create HTTP server
const server = http.createServer((req, res) => {
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        // Add other MIME types if needed
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code == 'ENOENT') {
                fs.readFile('./404.html', (err, cont) => { // Optional: serve a 404.html page
                    res.writeHead(404, { 'Content-Type': 'text/html' });
                    if (err) { // If 404.html also not found
                        res.end('404 Not Found (and no 404.html either!)', 'utf-8');
                    } else {
                        res.end(cont, 'utf-8');
                    }
                });
            } else {
                res.writeHead(500);
                res.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// Create WebSocket server and attach it to the HTTP server
const wss = new WebSocket.Server({ server }); // Attach to the existing HTTP server

// Store connected users: ws -> { id, peerId (current peer in call) }
const users = new Map();
// Store users waiting for a random call: id -> ws
const randomQueue = new Map();

// Start the HTTP server (which also hosts the WebSocket server)
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`WebSocket server is also attached and listening on port ${PORT}`);
});

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
                            // Check if target user is already in a call
                            if (targetUserDetails.peerId) {
                                ws.send(JSON.stringify({ type: 'call-failed', message: `User ${data.to} is already in a call.` }));
                                console.log(`Call attempt from ${currentUserId} to ${data.to} failed: target is busy.`);
                                return; // Stop further processing for this offer
                            }
                            // Check if current user is already in a call
                            if (currentUser.peerId) {
                                ws.send(JSON.stringify({ type: 'call-failed', message: `You are already in a call. Please hang up first.` }));
                                console.log(`Call attempt from ${currentUserId} to ${data.to} failed: caller is busy.`);
                                return;
                            }
                            currentUser.peerId = data.to;
                            targetUserDetails.peerId = currentUserId;
                            users.set(ws, currentUser);
                            users.set(targetUserWs, targetUserDetails);
                            console.log(`Call initiated between ${currentUserId} and ${data.to}`);
                        }
                    }
                    // If it's a hangup, clear peerIds
                    // The actual sending of 'hangup-received' to targetUserWs will be part of this block too.
                    if (data.type === 'hangup') {
                        console.log(`Hangup initiated by ${currentUserId} towards ${data.to} (targetUserWs: ${users.get(targetUserWs)?.id})`);
                        // Forward the hangup message to the target user first
                        // So they know the call is ending from the other side.
                        // Then clear peer info.
                        // (This forwarding is already handled by the generic forward below,
                        // but explicit handling for 'hangup-received' will be added in app.js)
                        clearPeerInfo(ws, targetUserWs);
                        console.log(`Call ended between ${currentUserId} and ${data.to} by ${currentUserId}. Peer info cleared.`);
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

                if (currentUser.peerId) {
                    ws.send(JSON.stringify({ type: 'error', message: 'You are already in a call or being connected. Please hang up first.' }));
                    console.log(`User ${currentUserId} tried to request random peer while already in call with ${currentUser.peerId}`);
                    return;
                }

                // Remove user from queue if they were already in it, to prevent self-pairing or re-pairing
                if (randomQueue.has(currentUserId)) {
                    console.log(`User ${currentUserId} was already in random queue, removing before attempting to find new peer.`);
                    randomQueue.delete(currentUserId);
                }

                // Check if there's anyone else in the queue
                if (randomQueue.size > 0) {
                    let peerId, peerWs;
                    // Iterate to find a suitable peer (not self)
                    for (const [pId, pWs] of randomQueue.entries()) {
                        if (pId !== currentUserId) { // Ensure not trying to pair with self if re-queued
                            peerId = pId;
                            peerWs = pWs;
                            break;
                        }
                    }

                    if (!peerWs) { // No suitable peer found (e.g., only self was in queue)
                        console.log(`No suitable random peer for ${currentUserId}. Adding to queue.`);
                        randomQueue.set(currentUserId, ws);
                        ws.send(JSON.stringify({ type: 'no-random-peer', message: 'Waiting for another user to join for a random call.' }));
                        return;
                    }


                    randomQueue.delete(peerId); // Remove found peer from queue
                    console.log(`Found random peer ${peerId} for ${currentUserId}. Removing ${peerId} from queue.`);

                    // Update peerIds for both
                    const peerUserDetails = users.get(peerWs);
                    if (peerUserDetails && !peerUserDetails.peerId && !currentUser.peerId) { // Double check both are free
                        currentUser.peerId = peerId;
                        peerUserDetails.peerId = currentUserId;
                        users.set(ws, currentUser);
                        users.set(peerWs, peerUserDetails);

                        // Tell the requester to make an offer to the peer
                        ws.send(JSON.stringify({ type: 'make-offer-to', peerId: peerId }));
                        // Tell the peer to expect an offer from the requester
                        peerWs.send(JSON.stringify({ type: 'expect-offer-from', peerId: currentUserId }));
                        console.log(`Pairing ${currentUserId} with random peer ${peerId}`);
                    } else {
                        // One of them got into a call in the meantime, or something went wrong.
                        // Put the peerWs back in queue if they are still free.
                        // The current user (ws) will have to try again.
                        console.error(`Failed to pair ${currentUserId} with ${peerId}. One or both may no longer be available or an error occurred.`);
                        if (peerUserDetails && !peerUserDetails.peerId && peerWs) {
                             // Only add back if they are still connected and not in a call
                            if (users.has(peerWs) && !users.get(peerWs).peerId) {
                                randomQueue.set(peerId, peerWs);
                                console.log(`Put user ${peerId} back into random queue.`);
                            }
                        }
                        // Inform current user to try again
                        ws.send(JSON.stringify({ type: 'no-random-peer', message: 'Could not connect to random user, please try again.' }));
                        // Current user is not added back to queue here, they need to click again.
                    }

                } else {
                    // Add user to the random queue
                    console.log(`Random queue is empty. Adding user ${currentUserId} to random queue. Queue size: ${randomQueue.size + 1}`);
                    randomQueue.set(currentUserId, ws);
                    ws.send(JSON.stringify({ type: 'no-random-peer', message: 'Waiting for another user to join for a random call.' }));
                }
                break;

            default:
                console.log(`Unknown message type: ${data.type}`);
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
            console.log(`User ${closedUser.id} disconnected. Current peerId: ${closedUser.peerId}`);
            const peerId = closedUser.peerId; // Store before potentially modifying closedUser
            const peerWs = findUserById(peerId);

            if (peerWs) {
                console.log(`User ${closedUser.id} was in a call with ${peerId}. Notifying peer.`);
                peerWs.send(JSON.stringify({ type: 'user-left', from: closedUser.id, details: 'Your peer has disconnected.' }));
                // Clear peer info for both the disconnected user (ws) and their peer (peerWs)
                clearPeerInfo(ws, peerWs); // This will nullify peerId for both from server's perspective
                console.log(`Notified user ${users.get(peerWs)?.id || peerId} that ${closedUser.id} has left and cleared peer info for both.`);
            } else if (peerId) {
                // PeerId was set, but peerWs not found (e.g., peer disconnected very recently or simultaneously)
                // We still need to ensure the closedUser's state is cleaned up regarding this peerId.
                // clearPeerInfo(ws, null) will handle clearing peerId for closedUser.
                console.log(`Peer ${peerId} for user ${closedUser.id} was not found (already disconnected or non-existent). Clearing peerId for ${closedUser.id}.`);
                clearPeerInfo(ws, null); // Clears peerId for closedUser
            }
            // Else, user was not in a call, no peer to notify or clear.

            users.delete(ws);
            console.log(`User ${closedUser.id} removed from users map. Users online: ${users.size}`);
            if (randomQueue.has(closedUser.id)) {
                randomQueue.delete(closedUser.id);
                console.log(`User ${closedUser.id} removed from random queue. Queue size: ${randomQueue.size}`);
            }
        } else {
            // This case should ideally not happen if ws was in users map.
            console.log('A WebSocket connection closed, but the user was not found in the users map.');
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
        if (user1Details.peerId) {
            console.log(`Clearing peerId for user ${user1Details.id} (was ${user1Details.peerId})`);
            user1Details.peerId = null;
            users.set(ws1, user1Details);
        } else {
            console.log(`User ${user1Details.id} did not have a peerId to clear.`);
        }
    } else {
        console.log("clearPeerInfo: ws1 not found in users map.");
    }

    if (ws2) { // ws2 might be null if peer was not found or already disconnected
        const user2Details = users.get(ws2);
        if (user2Details) {
            if (user2Details.peerId) {
                console.log(`Clearing peerId for user ${user2Details.id} (was ${user2Details.peerId})`);
                user2Details.peerId = null;
                users.set(ws2, user2Details);
            } else {
                console.log(`User ${user2Details.id} did not have a peerId to clear.`);
            }
        } else {
            console.log("clearPeerInfo: ws2 not found in users map (this might be expected if peer already disconnected).");
        }
    }
}

// Periodically log queue size and user states for debugging
setInterval(() => {
    if (randomQueue.size > 0) {
        console.log(`Current random queue size: ${randomQueue.size}. Users: ${Array.from(randomQueue.keys())}`);
    }
}, 30000);

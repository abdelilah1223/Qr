console.log("app.js loaded");

const myIdDisplay = document.getElementById('my-id');
const callBtn = document.getElementById('call-btn');
const randomCallBtn = document.getElementById('random-call-btn');
const peerIdInput = document.getElementById('peer-id-input');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const answerBtn = document.getElementById('answer-btn');
const hangupBtn = document.getElementById('hangup-btn');

let localStream;
let peerConnection;
let myId;
let currentPeerId = null; // To store the ID of the current peer in call
let ws; // WebSocket connection

const STUN_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
        // Consider adding a TURN server here for NAT traversal in more complex network scenarios
    ]
};

// Initialize WebSocket connection and WebRTC setup
async function init() {
    console.log("Initializing application...");
    try {
        console.log("Requesting media devices...");
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        console.log("Media devices obtained and local video stream attached.");
    } catch (error) {
        console.error('Error accessing media devices.', error);
        alert('Could not access your camera and microphone. Please allow access and try again. Error: ' + error.message);
        // Disable call buttons if media access fails
        callBtn.disabled = true;
        randomCallBtn.disabled = true;
        return;
    }

    // Determine WebSocket protocol (ws or wss)
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Construct WebSocket URL (assuming server.js is running on the same host and port 8080)
    // Construct WebSocket URL. It will connect to the same host and port
    // as the HTTP server that served the page.
    let wsUrl = `${wsProtocol}//${window.location.hostname}`;
    if (window.location.port) { // Add port only if it's specified
        wsUrl += `:${window.location.port}`;
    }

    console.log(`Attempting to connect to WebSocket server at ${wsUrl}`);
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('Connected to signaling server.');
        // Request an ID from the server
        // The server will assign an ID and send it back via a 'your-id' message.
    };

    ws.onmessage = async (message) => {
        const data = JSON.parse(message.data);
        console.log('Received message:', data);

        switch (data.type) {
            case 'your-id':
                myId = data.id;
                myIdDisplay.textContent = myId;
                break;
            case 'offer': // Incoming offer from a specific user or a matched random user
                currentPeerId = data.from;
                peerIdInput.value = data.from; // Keep input updated for display if needed, but use currentPeerId for logic
                console.log(`Incoming call/offer from ${currentPeerId}`);
                await handleOffer(data.offer, data.from); // fromId is still useful for handleOffer context
                break;
            case 'answer':
                await handleAnswer(data.answer);
                break;
            case 'candidate':
                await handleCandidate(data.candidate);
                break;
            case 'hangup': // Peer initiated hangup
                console.log(`Received hangup signal from ${data.from}`);
                alert(`Call with ${data.from || 'peer'} ended because they hung up.`);
                resetCallState();
                break;
            case 'user-left': // Peer disconnected abruptly
                handleUserLeft(); // This already calls resetCallState
                break;
            case 'busy':
                console.log(`Call attempt failed: User ${data.from} is busy.`);
                alert(`User ${data.from || 'peer'} is currently busy.`);
                resetCallState(); // Reset our state as the call cannot proceed
                break;
            case 'call-failed':
                alert(data.message);
                resetCallState();
                break;
            case 'make-offer-to': // Server instructed us to make an offer to data.peerId
                console.log(`Server instructed to make offer to ${data.peerId}`);
                currentPeerId = data.peerId;
                peerIdInput.value = data.peerId; // Set target for the call display
                makeCall(data.peerId); // This will create PC, offer and send it
                break;
            case 'expect-offer-from': // Server informed us to expect an offer from data.peerId
                console.log(`Expecting offer from ${data.peerId}`);
                currentPeerId = data.peerId;
                peerIdInput.value = data.peerId; // Good to know who is calling, update display
                // UI can be updated here, e.g., "Connecting to a random user..."
                // Actual offer will arrive as 'offer' type message
                break;
            case 'no-random-peer':
                alert(data.message || 'No random users available at the moment. Waiting in queue.');
                // Don't resetCallState here, user is now in the queue.
                // UI could reflect "Waiting for a random match..."
                callBtn.disabled = true; // Disable manual calling while in queue
                randomCallBtn.disabled = true; // Disable another random call request
                // A hangup button could cancel being in the queue.
                // For now, user has to refresh or wait.
                break;
            case 'error':
                console.error('Server error message:', data.message);
                alert(`Server error: ${data.message}`);
                break;
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        alert('WebSocket connection error. Please ensure the signaling server is running and accessible. Check console for details.');
    };

    ws.onclose = () => {
        console.log('Disconnected from signaling server.');
        alert('Disconnected from signaling server.');
        resetCallState();
    };
}


function createPeerConnection() {
    console.log(`Creating PeerConnection. Current peer: ${currentPeerId}. Local stream: ${localStream ? 'available' : 'not available'}`);
    if (!localStream) {
        console.error("Cannot create PeerConnection: localStream is not available.");
        alert("Error: Local video stream is not available. Cannot start call. Please ensure camera access is granted.");
        return null; // Return null to indicate failure
    }
    try {
        const pc = new RTCPeerConnection(STUN_SERVERS);

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`Sending ICE candidate to ${currentPeerId}:`, event.candidate);
                sendMessage({
                    type: 'candidate',
                    candidate: event.candidate,
                    to: currentPeerId
                });
            }
        };

        pc.oniceconnectionstatechange = (event) => {
            console.log(`ICE connection state changed: ${pc.iceConnectionState}`);
            if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed') {
                // You might want to handle this more gracefully, e.g. by trying to restart ICE or notifying the user.
                // For now, just log it. A 'user-left' or 'hangup' should eventually clean this up.
                console.warn(`ICE connection to ${currentPeerId} ${pc.iceConnectionState}.`);
            }
        };

        pc.ontrack = (event) => {
            console.log("Remote track received:", event.track, "Streams:", event.streams);
            if (event.streams && event.streams[0]) {
                if (remoteVideo.srcObject !== event.streams[0]) {
                    remoteVideo.srcObject = event.streams[0];
                    console.log("Remote video stream attached.");
                }
            } else {
                // Fallback for older browsers or different event structure
                // Ensure a new stream is created if remoteVideo.srcObject is null or different track
                if (!remoteVideo.srcObject || !remoteVideo.srcObject.getTracks().includes(event.track)) {
                     const newStream = remoteVideo.srcObject || new MediaStream();
                     newStream.addTrack(event.track);
                     remoteVideo.srcObject = newStream;
                     console.log("Remote video stream updated/attached (via track).");
                }
            }
        };

        localStream.getTracks().forEach(track => {
            console.log("Adding local track:", track);
            pc.addTrack(track, localStream);
        });
        console.log("Local tracks added to PeerConnection.");

        hangupBtn.style.display = 'inline-block';
        callBtn.disabled = true;
        randomCallBtn.disabled = true;
        peerIdInput.disabled = true;
        console.log("PeerConnection created and UI updated for active call.");
        return pc; // Return the created peerConnection
    } catch (e) {
        console.error("Error creating PeerConnection:", e);
        alert("Error setting up the call. Please check the console for details.");
        resetCallState(); // Reset if PC creation fails
        return null; // Return null to indicate failure
    }
}

async function makeCall(peerIdToCall) {
    if (!peerIdToCall) {
        alert('Please enter a Peer ID to call.');
        return;
    }
    if (peerIdToCall === myId) {
        alert("You can't call yourself.");
        return;
    }
    if (peerConnection) { // Check if already in a call or attempting one
        alert("You are already in a call or a call is being established. Please hang up first.");
        console.warn("makeCall attempted while peerConnection already exists.");
        return;
    }

    currentPeerId = peerIdToCall;
    peerIdInput.value = peerIdToCall;

    console.log(`Attempting to call ${currentPeerId}`);
    peerConnection = createPeerConnection();

    if (!peerConnection) {
        console.error("makeCall: PeerConnection not created (likely no localStream). Aborting call.");
        currentPeerId = null; // Reset currentPeerId as call cannot proceed
        // resetCallState(); // createPeerConnection should handle UI reset on critical failure if needed
        return;
    }

    try {
        console.log("Creating offer...");
        const offer = await peerConnection.createOffer();
        console.log("Setting local description with offer...");
        await peerConnection.setLocalDescription(offer);
        sendMessage({ type: 'offer', offer: offer, to: currentPeerId });
        console.log('Offer sent to:', currentPeerId);
    } catch (e) {
        console.error("Error creating or sending offer:", e);
        alert("Failed to create or send call offer. Check console for details.");
        resetCallState(); // Clean up if offer fails
    }
}

async function handleOffer(offer, fromId) {
    currentPeerId = fromId;
    peerIdInput.value = fromId;

    if (peerConnection) {
        console.warn(`Already have a peerConnection. Incoming call from ${fromId} ignored. Current peer: ${currentPeerId}`);
        sendMessage({ type: 'busy', to: fromId, from: myId });
        return;
    }
    console.log(`Handling offer from ${fromId}`);
    peerConnection = createPeerConnection();

    if (!peerConnection) {
        console.error("handleOffer: PeerConnection not created. Aborting handling offer.");
        currentPeerId = null; // Reset currentPeerId
        // resetCallState();
        return;
    }

    try {
        console.log(`Setting remote description for offer from ${fromId}`);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        console.log(`Creating answer for ${fromId}`);
        const answer = await peerConnection.createAnswer();
        console.log(`Setting local description with answer for ${fromId}`);
        await peerConnection.setLocalDescription(answer);
        sendMessage({ type: 'answer', answer: answer, to: currentPeerId });
        console.log('Answer sent to:', currentPeerId);
        // answerBtn.style.display = 'none'; // Already hidden or not used
    } catch (e) {
        console.error("Error handling offer or creating answer:", e);
        alert("Failed to handle incoming call or create answer. Check console for details.");
        resetCallState();
    }
}

async function handleAnswer(answer) {
    if (!peerConnection) {
        console.error("Received an answer but peerConnection is not initialized. CurrentPeerId:", currentPeerId);
        return;
    }
    console.log(`Received answer from ${currentPeerId}. Current remote description:`, peerConnection.currentRemoteDescription);
    if (!peerConnection.currentRemoteDescription) { // Only set if not already set
        try {
            console.log(`Attempting to set remote description from answer from ${currentPeerId}`);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            console.log(`Answer from ${currentPeerId} processed and remote description set.`);
        } catch (e) {
            console.error(`Error setting remote description from answer for ${currentPeerId}: `, e);
            alert(`Error processing call answer from ${currentPeerId}. Check console.`);
            resetCallState();
        }
    } else {
        console.warn(`Remote description already set for ${currentPeerId}. Ignoring subsequent answer.`);
    }
}

async function handleCandidate(candidate) {
    if (!peerConnection) {
        console.error("Received a candidate but peerConnection is not initialized. CurrentPeerId:", currentPeerId);
        return;
    }
    if (!peerConnection.remoteDescription) {
        console.warn(`Received candidate from ${currentPeerId} before remote description was set. Queuing or ignoring for now.`);
        // Optionally, queue candidates if this is a common issue, though typically remoteDescription should be set first.
        return;
    }
    try {
        if (candidate) {
            console.log(`Attempting to add ICE candidate from ${currentPeerId}:`, candidate);
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            console.log(`ICE candidate from ${currentPeerId} added successfully.`);
        }
    } catch (error) {
        console.error(`Error adding ICE candidate from ${currentPeerId}:`, error);
        // alert(`Error adding network candidate from ${currentPeerId}. Call may fail.`);
        // Not resetting call state here as some candidates might fail but call could still work
    }
}

function sendMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        // Ensure 'to' field is set for peer-specific messages if currentPeerId is known
        if (!message.to && (message.type === 'offer' || message.type === 'answer' || message.type === 'candidate' || message.type === 'hangup' || message.type === 'busy')) {
            if (currentPeerId && message.type !== 'busy') { // 'busy' message's 'to' is the sender of the offer
                 message.to = currentPeerId;
            } else if (!message.to) { // If still no 'to' (e.g. for busy, or if currentPeerId is null)
                console.error(`Cannot send message of type ${message.type} without a 'to' field. currentPeerId: ${currentPeerId}, message:`, message);
                // For 'busy' messages, 'to' should be passed explicitly.
                if (message.type !== 'busy' || !message.to) return; // Don't send if critical 'to' info is missing for non-busy
            }
        }
        console.log("Sending message: ", message);
        ws.send(JSON.stringify(message));
    } else {
        console.error('WebSocket is not connected. Cannot send message:', message);
        alert('Not connected to the signaling server. Cannot send message.');
    }
}

function hangUp() {
    console.log(`Hangup initiated. Current peer: ${currentPeerId}`);
    if (currentPeerId && peerConnection) { // Check peerConnection as well, to only send if in an active call
        sendMessage({ type: 'hangup', to: currentPeerId });
        console.log(`Sent hangup to ${currentPeerId}`);
    } else {
        console.log("Hangup called but no currentPeerId or peerConnection to send hangup to. Resetting locally.");
    }
    // Always reset local state regardless of whether hangup was sent
    closeConnection(); // This sets peerConnection to null
    resetCallState();  // This sets currentPeerId to null and resets UI
}

function closeConnection() {
    if (peerConnection) {
        console.log("Closing PeerConnection.");
        peerConnection.getSenders().forEach(sender => {
            if (sender.track) {
                sender.track.stop(); // Stop media tracks
            }
        });
        peerConnection.close();
        peerConnection = null; // Crucial: set to null after closing
        console.log("PeerConnection closed and set to null.");
    }
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject.getTracks().forEach(track => track.stop());
        remoteVideo.srcObject = null;
        console.log("Remote video stream stopped and cleared.");
    }
}

function resetCallState() {
    console.log("Resetting call state...");
    closeConnection(); // Ensure connection is fully closed first

    hangupBtn.style.display = 'none';
    answerBtn.style.display = 'none'; // Though not actively used, good to reset
    callBtn.disabled = false;
    randomCallBtn.disabled = false;
    peerIdInput.disabled = false;
    peerIdInput.value = '';
    currentPeerId = null;
    console.log("Call state reset. currentPeerId is now null. UI elements reset.");

    // Do NOT stop localStream here if you want the user to be able to make another call
    // without re-requesting camera/mic permissions.
    // If you want to release camera/mic:
    // if (localStream) {
    //     localStream.getTracks().forEach(track => track.stop());
    //     localStream = null;
    //     localVideo.srcObject = null;
    //     console.log("Local stream tracks stopped and cleared.");
    //     // Optionally re-enable init() or a part of it if media needs to be reacquired.
    //     // For now, assume local stream should persist for subsequent calls.
    // }
}

function handleUserLeft() {
    console.log(`Peer ${currentPeerId || '(unknown)'} has left the call.`);
    alert(`The other user (${currentPeerId || 'peer'}) has left the call.`);
    //     localStream = null;
    // }
    // init(); // Re-initialize to get new local stream if stopped
}

function handleUserLeft() {
    alert('The other user has left the call.');
    resetCallState();
}


callBtn.addEventListener('click', () => {
    makeCall(peerIdInput.value.trim());
});

randomCallBtn.addEventListener('click', () => {
    console.log('Requesting random peer...');
    sendMessage({ type: 'request-random-peer', from: myId });
    // Server will respond with 'random-offer' if a peer is found, or 'no-random-peer'
    // UI changes (disabling buttons) will happen upon successful offer exchange initiation
});

hangupBtn.addEventListener('click', hangUp);

// No explicit answer button needed for now, as offers are auto-accepted.
// If manual answer is desired, uncomment the answerBtn display in handleOffer
// and add an event listener for answerBtn to call createAnswer and send it.

// Initialize the application
init();

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
let ws; // WebSocket connection

const STUN_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Initialize WebSocket connection and WebRTC setup
async function init() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (error) {
        console.error('Error accessing media devices.', error);
        alert('Could not access your camera and microphone. Please allow access and try again. Error: ' + error.message);
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
                peerIdInput.value = data.from; // Set who the offer is from
                await handleOffer(data.offer, data.from);
                break;
            case 'answer':
                await handleAnswer(data.answer);
                break;
            case 'candidate':
                await handleCandidate(data.candidate);
                break;
            case 'user-left':
                handleUserLeft();
                break;
            case 'call-failed':
                alert(data.message);
                resetCallState();
                break;
            case 'make-offer-to': // Server instructed us to make an offer to data.peerId
                console.log(`Server instructed to make offer to ${data.peerId}`);
                peerIdInput.value = data.peerId; // Set target for the call
                makeCall(data.peerId); // This will create PC, offer and send it
                break;
            case 'expect-offer-from': // Server informed us to expect an offer from data.peerId
                console.log(`Expecting offer from ${data.peerId}`);
                peerIdInput.value = data.peerId; // Good to know who is calling
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
    peerConnection = new RTCPeerConnection(STUN_SERVERS);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendMessage({
                type: 'candidate',
                candidate: event.candidate,
                to: peerIdInput.value || (peerConnection.currentRemoteDescription ? peerConnection.currentRemoteDescription.spd : null) // Send to current peer
            });
        }
    };

    peerConnection.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
        }
    };

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    hangupBtn.style.display = 'inline-block';
    callBtn.disabled = true;
    randomCallBtn.disabled = true;
    peerIdInput.disabled = true;
}

async function makeCall(peerId) {
    if (!peerId) {
        alert('Please enter a Peer ID to call.');
        return;
    }
    if (peerId === myId) {
        alert("You can't call yourself.");
        return;
    }

    createPeerConnection();
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    sendMessage({ type: 'offer', offer: offer, to: peerId });
    console.log('Offer sent to:', peerId);
}

async function handleOffer(offer, fromId) {
    if (peerConnection) { // If already in a call or call attempt
        console.warn('Existing peer connection. Ignoring new offer for now.');
        // Optionally, send a "busy" signal back
        // sendMessage({ type: 'busy', to: fromId });
        return;
    }
    createPeerConnection();
    peerIdInput.value = fromId; // So we know who we are talking to for candidates

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    sendMessage({ type: 'answer', answer: answer, to: fromId });
    console.log('Answer sent to:', fromId);
    answerBtn.style.display = 'none'; // Hide if it was shown
}

async function handleAnswer(answer) {
    if (!peerConnection.currentRemoteDescription) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('Answer received and processed.');
    } else {
        console.warn('Remote description already set. Ignoring answer.');
    }
}

async function handleCandidate(candidate) {
    try {
        if (candidate) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            console.log('ICE candidate added.');
        }
    } catch (error) {
        console.error('Error adding ICE candidate:', error);
    }
}

function sendMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        // If 'to' is not set, the server will handle it (e.g., for candidates during an active call)
        // or it's a message directly for the server (like 'request-random-peer')
        if (!message.to && peerConnection && peerConnection.currentRemoteDescription) {
             // Try to infer 'to' if it's a candidate and peerIdInput might have been cleared
             // This part is tricky if peerIdInput.value is not reliable source of truth for current peer
        }
        ws.send(JSON.stringify(message));
    } else {
        console.error('WebSocket is not connected.');
        alert('Not connected to the signaling server. Cannot send message.');
    }
}

function hangUp() {
    sendMessage({ type: 'hangup', to: peerIdInput.value });
    closeConnection();
    resetCallState();
}

function closeConnection() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
}

function resetCallState() {
    closeConnection();
    hangupBtn.style.display = 'none';
    answerBtn.style.display = 'none';
    callBtn.disabled = false;
    randomCallBtn.disabled = false;
    peerIdInput.disabled = false;
    peerIdInput.value = ''; // Clear peer ID input
    // localVideo.srcObject = null; // Keep local video running for next call
    // if (localStream) {
    //     localStream.getTracks().forEach(track => track.stop());
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

let userId;
let socket;
let peerConnection;
let localStream;
let remoteStream;
let isCaller = false;

// تهيئة التطبيق عند تحميل الصفحة
window.onload = async function() {
    await setupLocalStream();
    setupWebSocket();
};

async function setupLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('local-video').srcObject = localStream;
    } catch (error) {
        console.error('Error accessing media devices:', error);
        showStatus('خطأ في الوصول إلى الكاميرا أو الميكروفون');
    }
}

function setupWebSocket() {
    socket = new WebSocket(`ws://${window.location.hostname}:${window.location.port}`);
    
    socket.onmessage = function(event) {
        const data = JSON.parse(event.data);
        
        switch(data.type) {
            case 'your-id':
                userId = data.userId;
                document.getElementById('user-id').value = userId;
                break;
            case 'no-users':
                showStatus('لا يوجد مستخدمون متصلون حالياً');
                break;
            case 'user-not-found':
                showStatus('المستخدم غير متصل');
                break;
            case 'initiate-call':
                isCaller = data.isCaller;
                startCall(data.targetId);
                break;
            case 'webrtc-offer':
                handleOffer(data);
                break;
            case 'webrtc-answer':
                handleAnswer(data);
                break;
            case 'ice-candidate':
                handleIceCandidate(data);
                break;
            case 'end-call':
                endCall();
                break;
        }
    };
}

function connectRandom() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        showStatus('الاتصال بالسيرفر غير متاح');
        return;
    }
    
    socket.send(JSON.stringify({
        type: 'random-connect'
    }));
}

function connectToUser() {
    const targetId = document.getElementById('target-id').value.trim();
    
    if (!targetId) {
        showStatus('الرجاء إدخال ID المستخدم');
        return;
    }
    
    if (targetId === userId) {
        showStatus('لا يمكن الاتصال بنفسك');
        return;
    }
    
    socket.send(JSON.stringify({
        type: 'connect-to',
        targetId: targetId
    }));
}

function startCall(targetId) {
    document.getElementById('intro-screen').style.display = 'none';
    document.getElementById('call-screen').style.display = 'block';
    
    setupPeerConnection(targetId);
    
    if (isCaller) {
        createOffer(targetId);
    }
}

function setupPeerConnection(targetId) {
    const configuration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }
        ]
    };
    
    peerConnection = new RTCPeerConnection(configuration);
    
    // إضافة التدفق المحلي
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });
    
    // معالجة التدفق البعيد
    peerConnection.ontrack = function(event) {
        remoteStream = event.streams[0];
        document.getElementById('remote-video').srcObject = remoteStream;
        document.getElementById('local-video-small').srcObject = localStream;
    };
    
    // جمع وإرسال ICE Candidates
    peerConnection.onicecandidate = function(event) {
        if (event.candidate) {
            socket.send(JSON.stringify({
                type: 'ice-candidate',
                targetId: targetId,
                candidate: event.candidate
            }));
        }
    };
}

async function createOffer(targetId) {
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        socket.send(JSON.stringify({
            type: 'webrtc-offer',
            targetId: targetId,
            offer: offer
        }));
    } catch (error) {
        console.error('Error creating offer:', error);
        showStatus('خطأ في إنشاء عرض الاتصال');
    }
}

async function handleOffer(data) {
    try {
        await peerConnection.setRemoteDescription(data.offer);
        
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        socket.send(JSON.stringify({
            type: 'webrtc-answer',
            targetId: data.targetId,
            answer: answer
        }));
    } catch (error) {
        console.error('Error handling offer:', error);
        showStatus('خطأ في معالجة عرض الاتصال');
    }
}

async function handleAnswer(data) {
    try {
        await peerConnection.setRemoteDescription(data.answer);
    } catch (error) {
        console.error('Error handling answer:', error);
        showStatus('خطأ في معالجة إجابة الاتصال');
    }
}

async function handleIceCandidate(data) {
    try {
        await peerConnection.addIceCandidate(data.candidate);
    } catch (error) {
        console.error('Error adding ICE candidate:', error);
    }
}

function endCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    document.getElementById('intro-screen').style.display = 'block';
    document.getElementById('call-screen').style.display = 'none';
    document.getElementById('remote-video').srcObject = null;
    
    // إعلام الطرف الآخر بإنهاء المكالمة
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'end-call'
        }));
    }
}

function copyUserId() {
    const userIdInput = document.getElementById('user-id');
    userIdInput.select();
    document.execCommand('copy');
    showStatus('تم نسخ المعرف');
}

function showStatus(message) {
    const statusElement = document.getElementById('status-message');
    statusElement.textContent = message;
    
    setTimeout(() => {
        statusElement.textContent = '';
    }, 3000);
}

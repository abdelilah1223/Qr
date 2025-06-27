const express = require('express');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const helmet = require('helmet');

const app = express();

// تحسينات الأمان
app.use(helmet());
app.use(cors());

// خدمة الملفات الثابتة (سيكون ملف HTML الخاص بالعميل هنا)
app.use(express.static('public'));

// إنشاء سيرفر HTTP
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`السيرفر يعمل على المنفذ ${PORT}`);
});

// إنشاء سيرفر WebSocket
const wss = new WebSocket.Server({ server });

// تخزين المستخدمين النشطين
const activeUsers = new Map();

// معالجة اتصالات WebSocket
wss.on('connection', (ws) => {
  // توليد معرف فريد للمستخدم
  const userId = uuidv4();
  activeUsers.set(userId, ws);
  
  // إرسال معرف المستخدم للعميل
  ws.send(JSON.stringify({
    type: 'user-id',
    userId
  }));
  
  // معالجة الرسائل الواردة من العميل
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleClientMessage(userId, data);
    } catch (error) {
      console.error('خطأ في معالجة الرسالة:', error);
    }
  });
  
  // معالجة إغلاق الاتصال
  ws.on('close', () => {
    activeUsers.delete(userId);
    notifyUserDisconnection(userId);
  });
  
  // معالجة الأخطاء
  ws.on('error', (error) => {
    console.error('حدث خطأ في WebSocket:', error);
    activeUsers.delete(userId);
    notifyUserDisconnection(userId);
  });
});

// معالجة رسائل العميل
function handleClientMessage(senderId, data) {
  switch (data.type) {
    case 'random-call-request':
      handleRandomCallRequest(senderId);
      break;
      
    case 'direct-call-request':
      handleDirectCallRequest(senderId, data.targetId);
      break;
      
    case 'call-accepted':
      handleCallAccepted(senderId, data.callId);
      break;
      
    case 'call-rejected':
      handleCallRejected(senderId, data.callerId, data.reason);
      break;
      
    case 'offer':
      forwardOffer(senderId, data.targetId, data.offer, data.callId);
      break;
      
    case 'answer':
      forwardAnswer(senderId, data.targetId, data.answer, data.callId);
      break;
      
    case 'candidate':
      forwardCandidate(senderId, data.targetId, data.candidate, data.callId);
      break;
      
    case 'end-call':
      handleEndCall(senderId, data.callId);
      break;
      
    default:
      console.log('رسالة غير معروفة:', data);
  }
}

// معالجة طلب اتصال عشوائي
function handleRandomCallRequest(senderId) {
  // تصفية المستخدمين المتاحين (غير المرسل ولا منخرطين في مكالمة)
  const availableUsers = Array.from(activeUsers.keys()).filter(
    userId => userId !== senderId && !isUserInCall(userId)
  );
  
  if (availableUsers.length === 0) {
    sendError(senderId, 'لا يوجد مستخدمون متاحون للاتصال العشوائي حالياً');
    return;
  }
  
  // اختيار مستخدم عشوائي
  const randomIndex = Math.floor(Math.random() * availableUsers.length);
  const targetId = availableUsers[randomIndex];
  
  // إنشاء معرف فريد للمكالمة
  const callId = uuidv4();
  
  // إرسال طلب الاتصال للمستخدم المستهدف
  sendMessage(targetId, {
    type: 'incoming-call',
    callerId: senderId,
    callId
  });
}

// معالجة طلب اتصال موجه
function handleDirectCallRequest(senderId, targetId) {
  // التحقق من وجود المستخدم المستهدف
  if (!activeUsers.has(targetId)) {
    sendError(senderId, 'المستخدم غير متصل حالياً');
    return;
  }
  
  // التحقق من أن المستخدم غير متصل بنفسه
  if (senderId === targetId) {
    sendError(senderId, 'لا يمكنك الاتصال بنفسك');
    return;
  }
  
  // التحقق من أن المستخدم المستهدف غير مشغول
  if (isUserInCall(targetId)) {
    sendError(senderId, 'المستخدم مشغول حالياً في مكالمة أخرى');
    return;
  }
  
  // إنشاء معرف فريد للمكالمة
  const callId = uuidv4();
  
  // إرسال طلب الاتصال للمستخدم المستهدف
  sendMessage(targetId, {
    type: 'incoming-call',
    callerId: senderId,
    callId
  });
  
  // إرسال تأكيد بدء الاتصال للمستخدم المرسل
  sendMessage(senderId, {
    type: 'call-started',
    targetId,
    callId
  });
}

// معالجة قبول الاتصال
function handleCallAccepted(senderId, callId) {
  // في هذه الحالة، لا نحتاج لعمل شيء إضافي
  // لأن العميل سيرسل عرض (offer) مباشرة بعد القبول
}

// معالجة رفض الاتصال
function handleCallRejected(senderId, callerId, reason) {
  sendMessage(callerId, {
    type: 'call-rejected',
    userId: senderId,
    reason
  });
}

// معالجة إنهاء الاتصال
function handleEndCall(senderId, callId) {
  // هنا يمكنك تنفيذ أي منطق إضافي لإنهاء الاتصال
  // مثل إرسال إشعار للمستخدم الآخر
  sendMessage(senderId, {
    type: 'call-ended',
    callId
  });
}

// إعادة توجيه عرض WebRTC
function forwardOffer(senderId, targetId, offer, callId) {
  sendMessage(targetId, {
    type: 'offer',
    senderId,
    offer,
    callId
  });
}

// إعادة توجيه إجابة WebRTC
function forwardAnswer(senderId, targetId, answer, callId) {
  sendMessage(targetId, {
    type: 'answer',
    senderId,
    answer,
    callId
  });
}

// إعادة توجيه مرشح ICE
function forwardCandidate(senderId, targetId, candidate, callId) {
  sendMessage(targetId, {
    type: 'candidate',
    senderId,
    candidate,
    callId
  });
}

// إرسال رسالة خطأ
function sendError(userId, message) {
  sendMessage(userId, {
    type: 'error',
    message
  });
}

// إرسال رسالة لمستخدم معين
function sendMessage(userId, message) {
  const ws = activeUsers.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// إعلام بفصل مستخدم
function notifyUserDisconnection(userId) {
  // يمكنك هنا إضافة أي منطق إضافي عند فصل مستخدم
  console.log(`المستخدم ${userId} انقطع عن الاتصال`);
}

// التحقق إذا كان المستخدم في مكالمة حالياً
function isUserInCall(userId) {
  // في هذا المثال البسيط، نفترض أن المستخدم ليس في مكالمة
  // في تطبيق حقيقي، قد تريد تتبع حالة المكالمات لكل مستخدم
  return false;
}

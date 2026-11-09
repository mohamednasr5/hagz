/**
 * telegram.js - Telegram Public Bot & Notification Engine
 * Manages subscriber database, commands (/start, /subscribe, /unsubscribe, /today, /available, /help),
 * and dispatches notifications for bookings, cancellations, and expirations.
 */

const axios = require('axios');
const admin = require('firebase-admin');

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

/** Convert stored HH:mm into a 12-hour Arabic time for notifications. */
function formatTime12Hour(time) {
  if (!time || typeof time !== 'string') return '';
  const [hourPart, minutePart = '00'] = time.split(':');
  const hour = Number(hourPart);
  const suffix = hour >= 12 ? 'م' : 'ص';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutePart} ${suffix}`;
}

function formatBookingRange(booking) {
  return `${formatTime12Hour(booking.startTime)} - ${formatTime12Hour(booking.endTime)}`;
}

/**
 * Gets configured Bot Token securely from environment or Realtime Database settings
 */
async function getBotToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) {
    return process.env.TELEGRAM_BOT_TOKEN;
  }
  const snap = await admin.database().ref('settings/telegramBotToken').once('value');
  return snap.val();
}

/**
 * Sends a message via Telegram Bot API
 */
async function sendMessage(chatId, text, parseMode = 'HTML') {
  const token = await getBotToken();
  if (!token) {
    console.warn('Telegram Bot Token not configured, skipping message.');
    return false;
  }

  try {
    const url = `${TELEGRAM_API_BASE}${token}/sendMessage`;
    await axios.post(url, {
      chat_id: chatId,
      text,
      parse_mode: parseMode
    });
    return true;
  } catch (error) {
    console.error(`Error sending message to chatId ${chatId}:`, error.response ? error.response.data : error.message);
    return false;
  }
}

/**
 * Broadcasts a notification to all active Telegram subscribers
 */
async function broadcastToSubscribers(text) {
  const subscribersSnap = await admin.database().ref('telegramSubscribers').once('value');
  const subscribers = subscribersSnap.val() || {};

  const sendPromises = Object.keys(subscribers).map((chatId) => {
    return sendMessage(chatId, text).catch(() => {});
  });

  await Promise.all(sendPromises);
}

/**
 * Handles incoming Telegram Webhook updates
 */
async function handleTelegramUpdate(update) {
  if (!update || !update.message || !update.message.text) return;

  const message = update.message;
  const chatId = message.chat.id;
  const text = message.text.trim();
  const userName = message.from.first_name || 'عزيزي الرياضي';

  if (text.startsWith('/start')) {
    const welcome = `
⚽ <b>أهلاً بك يا ${userName} في بوت ملعب الأحمدية الخماسي!</b>

نظام المتابعة والإشعار اللحظي لملعب كرة القدم الخماسي بمركز شباب الأحمدية.
من خلال هذا البوت، يمكنك الاشتراك في تنبيهات المواعيد وتلقي إشعارات الحجز المباشر.

📋 <b>الأوامر المتاحة:</b>
/subscribe - الاشتراك في الإشعارات الفورية
/unsubscribe - إلغاء الاشتراك
/today - عرض جدول مباريات اليوم
/available - المواعيد الشاغرة اليوم
/help - المساعدة والدعم
    `;
    await sendMessage(chatId, welcome);

  } else if (text.startsWith('/subscribe')) {
    await admin.database().ref(`telegramSubscribers/${chatId}`).set({
      chatId,
      name: `${message.from.first_name || ''} ${message.from.last_name || ''}`.trim(),
      username: message.from.username || null,
      subscribedAt: Date.now()
    });

    const reply = `
✅ <b>تم اشتراكك بنجاح في إشعارات ملعب الأحمدية!</b>
ستصلك تنبيهات فورية عند تأكيد أي حجز جديد أو انتهاء وقت المباريات.
    `;
    await sendMessage(chatId, reply);

  } else if (text.startsWith('/unsubscribe')) {
    await admin.database().ref(`telegramSubscribers/${chatId}`).remove();
    await sendMessage(chatId, '❌ تم إلغاء اشتراكك من الإشعارات. يمكنك العودة والاشتراك بأي وقت عبر /subscribe.');

  } else if (text.startsWith('/today')) {
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);
    const snap = await admin.database().ref(`bookings/${todayKey}`).once('value');
    const bookings = snap.val() || {};

    let scheduleText = `📅 <b>جدول مباريات اليوم (${todayKey}):</b>\n\n`;
    const sorted = Object.values(bookings)
      .filter(b => b.status === 'confirmed')
      .sort((a, b) => a.startTimestamp - b.startTimestamp);

    if (sorted.length === 0) {
      scheduleText += 'لا توجد حجوزات مؤكدة مسجلة لليوم حتى الآن.';
    } else {
      sorted.forEach(b => {
        scheduleText += `⏰ <b>${formatBookingRange(b)}</b>: محجوز (${b.period || 'خماسي'})\n`;
      });
    }

    await sendMessage(chatId, scheduleText);

  } else if (text.startsWith('/available')) {
    await sendMessage(chatId, 'يمكنك تصفح جميع الساعات المتاحة وحجز موعدك لحظياً عبر الرابط:\nhttps://mohamednasr5.github.io/hagz/');

  } else if (text.startsWith('/help')) {
    await sendMessage(chatId, 'لأي استفسار أو مساعدة، يرجى التواصل مع إدارة مركز شباب الأحمدية.');
  }
}

/**
 * Notification on Booking Confirmed
 */
async function notifyBookingConfirmed(booking) {
  const msg = `
⚽ <b>AHMADIAH FOOTBALL PITCH</b>
تم تأكيد حجز جديد في الملعب!

📅 <b>التاريخ:</b> ${booking.date}
🕒 <b>الوقت:</b> ${formatBookingRange(booking)}
🌙 <b>الفترة:</b> ${booking.period || 'نهاري/ليلي'}
📌 <b>الحالة:</b> محجوز ومؤكد (BOOKED)

📍 <i>مركز شباب الأحمدية - ملعب كرة القدم الخماسي</i>
  `;
  await broadcastToSubscribers(msg);
}

/**
 * Notification on Booking Expired
 */
async function notifyBookingExpired(booking) {
  const msg = `
⏰ <b>BOOKING TIME EXPIRED</b>
انتهت فترة المباراة المحددة.

📅 <b>التاريخ:</b> ${booking.date}
🕒 <b>الوقت المنتهي:</b> ${booking.startTime} - ${booking.endTime}

الملعب جاهز لاستقبال الحجز القادم.
📍 <i>مركز شباب الأحمدية</i>
  `;
  await broadcastToSubscribers(msg);
}

/**
 * Notification on Booking Cancelled
 */
async function notifyBookingCancelled(booking) {
  const msg = `
📢 <b>تنويه بإتاحة موعد في الملعب</b>
تم إلغاء حجز وأصبح الموعد شاغراً الآن:

📅 <b>التاريخ:</b> ${booking.date}
🕒 <b>الوقت المتاح:</b> ${booking.startTime} - ${booking.endTime}

يمكنك الحجز الفوري الآن عبر الموقع!
  `;
  await broadcastToSubscribers(msg);
}

module.exports = {
  handleTelegramUpdate,
  broadcastToSubscribers,
  notifyBookingConfirmed,
  notifyBookingExpired,
  notifyBookingCancelled
};

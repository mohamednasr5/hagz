/**
 * bot-runner.js - Standalone 24/7 Telegram Bot Runner
 * Pure Node.js (zero dependencies, uses standard built-in https module).
 * Connects directly to Telegram Bot API & Firebase Realtime Database.
 * Handles /start, /subscribe, /unsubscribe, /today, /available, /help,
 * and broadcasts notifications when bookings change.
 */

const https = require('https');

const BOT_TOKEN = '9099414918:AAEw4nqGbWP4pixVcI05olGLTag5H42vkhE';
const FIREBASE_DB_BASE = 'https://hagz-a49fa-default-rtdb.firebaseio.com';

let lastUpdateId = 0;
// Track notified bookings: key = `${id}_${status}` to re-notify on status change
const notifiedKeys = new Set();
let botStartTimestamp = Date.now(); // Only notify bookings created AFTER bot starts

console.log('----------------------------------------------------');
console.log('🤖 بوت ملعب مركز شباب الأحمدية قيد التشغيل والجاهزية...');
console.log('Bot Username: @AhmadiahPitchBot');
console.log('وقت البدء:', new Date().toLocaleString('ar-EG', {timeZone:'Africa/Cairo'}));
console.log('----------------------------------------------------');


/**
 * Generic HTTPS JSON Request Helper
 */
function request(url, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = https.request(reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed);
        } catch (e) {
          resolve(body);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(35000, () => {
      req.abort();
      reject(new Error('Request timeout'));
    });

    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

/**
 * Sends a message via Telegram Bot API
 */
async function sendTelegramMessage(chatId, text, replyMarkup = null) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML'
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  try {
    return await request(url, { method: 'POST' }, payload);
  } catch (err) {
    console.error(`Error sending message to chatId ${chatId}:`, err.message);
    return null;
  }
}

/**
 * Converts 24H time "17:00" to 12H Arabic "05:00 م"
 */
function to12H(time24) {
  if (!time24) return '';
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  const period = h >= 12 ? 'م' : 'ص';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${period}`;
}

/**
 * Gets Egypt Date Key YYYY-MM-DD
 */
function getEgyptDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

/**
 * Handles Incoming Telegram Message
 */
async function handleTelegramMessage(message) {
  if (!message || !message.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();
  const userName = message.from.first_name || 'كابتن';

  console.log(`[Telegram Update] From: ${userName} (${chatId}) | Text: ${text}`);

  if (text.startsWith('/start')) {
    const welcome = `
⚽ <b>أهلاً بك يا ${userName} في بوت ملعب الأحمدية الخماسي!</b>

نظام المتابعة والإشعار اللحظي لملعب كرة القدم بمركز شباب الأحمدية.
📍 <b>الموقع:</b> قرية الأحمدية - مركز المنزلة - محافظة الدقهلية.

اضغط على <b>/subscribe</b> لتفعيل اشتراكك في إشعارات المواعيد والتنبيهات المباشرة.

📋 <b>الأوامر السريعة:</b>
/subscribe - تفعيل إشعارات الحجز المباشر 🔔
/today - جدول مباريات ومواعيد اليوم 📅
/available - المواعيد المتاحة للحجز اليوم ⚡
/unsubscribe - إلغاء الاشتراك ❌
/help - المساعدة والدعم ℹ️
    `;
    const keyboard = {
      keyboard: [
        [{ text: '/today 📅 مباريات اليوم' }, { text: '/available ⚡ المواعيد المتاحة' }],
        [{ text: '/subscribe 🔔 تفعيل الإشعارات' }, { text: '/help ℹ️ مساعدة' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    };

    await sendTelegramMessage(chatId, welcome, keyboard);

  } else if (text.startsWith('/subscribe') || text.includes('تفعيل الإشعارات')) {
    // Save to Firebase Realtime Database
    const subscriberData = {
      chatId,
      name: `${message.from.first_name || ''} ${message.from.last_name || ''}`.trim(),
      username: message.from.username ? `@${message.from.username}` : null,
      subscribedAt: Date.now()
    };

    await request(`${FIREBASE_DB_BASE}/telegramSubscribers/${chatId}.json`, { method: 'PUT' }, subscriberData);

    const reply = `
✅ <b>تم تفعيل اشتراكك بنجاح في إشعارات ملعب الأحمدية!</b>

ستصلك رسائل فورية هنا عند:
● تأكيد أي حجز جديد وموعد المباراة 📅
● انتهاء وقت المباريات وجاهزية الملعب ⏰
● إتاحة أي موعد بعد إلغائه ⚡
    `;
    await sendTelegramMessage(chatId, reply);

  } else if (text.startsWith('/unsubscribe')) {
    await request(`${FIREBASE_DB_BASE}/telegramSubscribers/${chatId}.json`, { method: 'DELETE' });
    await sendTelegramMessage(chatId, '❌ تم إلغاء اشتراكك بنجاح. يمكنك العودة والاشتراك بأي وقت عبر الأمر /subscribe.');

  } else if (text.startsWith('/today') || text.includes('مباريات اليوم')) {
    const todayKey = getEgyptDateKey();
    const bookingsData = await request(`${FIREBASE_DB_BASE}/bookings/${todayKey}.json`) || {};

    const confirmed = Object.values(bookingsData)
      .filter(b => b.status === 'confirmed')
      .sort((a, b) => a.startTimestamp - b.startTimestamp);

    let reply = `📅 <b>جدول مباريات اليوم (${todayKey}):</b>\n\n`;

    if (confirmed.length === 0) {
      reply += '🟢 الملعب متاح بالكامل اليوم ولا توجد مباريات مسجلة بعد.\n\nلحجز موعدك تصفح الموقع:\nhttps://mohamednasr5.github.io/hagz/';
    } else {
      confirmed.forEach((b) => {
        const start12 = to12H(b.startTime);
        const end12 = to12H(b.endTime);
        const period = (b.period || '').includes('ليل') ? '🌙 ليلي' : '☀️ نهاري';
        reply += `⏰ <b>${start12} - ${end12}</b> (${period})\n👤 ${b.customerName || 'محجوز'}\n\n`;
      });
      reply += `📌 لحجز الساعات الشاغرة: /available`;
    }

    await sendTelegramMessage(chatId, reply);

  } else if (text.startsWith('/available') || text.includes('المواعيد المتاحة')) {
    const todayKey = getEgyptDateKey();
    const bookingsData = await request(`${FIREBASE_DB_BASE}/bookings/${todayKey}.json`) || {};

    const bookedTimes = new Set();
    Object.values(bookingsData).forEach(b => {
      if (b.status === 'confirmed' || b.status === 'pending') {
        bookedTimes.add(b.startTime);
      }
    });

    const allSlots = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00', '00:00'];
    const availableSlots = allSlots.filter(s => !bookedTimes.has(s));

    let reply = `⚡ <b>المواعيد الشاغرة المتاحة للحجز اليوم (${todayKey}):</b>\n\n`;

    if (availableSlots.length === 0) {
      reply += '🔴 كامل ساعات اليوم محجوزة بالكامل. يمكنك مراجعة مواعيد الأيام القادمة عبر الموقع.';
    } else {
      availableSlots.forEach(s => {
        reply += `🟢 <b>${to12H(s)}</b>: متاح للحجز الفوري\n`;
      });
      reply += '\n📲 <b>لحجز موعدك لحظياً:</b>\nhttps://mohamednasr5.github.io/hagz/';
    }

    await sendTelegramMessage(chatId, reply);

  } else if (text.startsWith('/help') || text.includes('مساعدة')) {
    const help = `
ℹ️ <b>معلومات ودعم ملعب مركز شباب الأحمدية</b>

📍 <b>العنوان:</b> قرية الأحمدية - مركز المنزلة - محافظة الدقهلية
⚽ <b>المواصفات:</b> ملعب خماسي نجيل صناعي تركي من الجيل الجديد + كشافات إنارة ليلية.

🌐 <b>الموقع الرسمي للحجز المباشر:</b>
https://mohamednasr5.github.io/hagz/

لأي استفسارات خاصة بإدارة الملعب، تفضل بزيارة مركز شباب الأحمدية.
    `;
    await sendTelegramMessage(chatId, help);
  }
}

/**
 * Long Polling loop for Telegram Bot
 */
async function pollTelegramUpdates() {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId}&timeout=20`;

  try {
    const response = await request(url);
    if (response && response.ok && Array.isArray(response.result)) {
      for (const update of response.result) {
        lastUpdateId = update.update_id + 1;
        if (update.message) {
          await handleTelegramMessage(update.message);
        }
      }
    }
  } catch (err) {
    if (!err.message.includes('timeout')) {
      console.warn('Polling error (will retry):', err.message);
    }
  }

  // Next poll
  setTimeout(pollTelegramUpdates, 1000);
}

/**
 * Watcher for new confirmed/pending bookings to broadcast to Telegram subscribers
 * Runs every 10 seconds and checks today + tomorrow
 */
async function checkBookingNotifications() {
  try {
    const todayKey = getEgyptDateKey();

    // Build list of dates to check: today + tomorrow (for bookings made now that start tomorrow)
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(tomorrowDate);

    const datesToCheck = [todayKey, tomorrowKey];

    // Get subscribers once
    const subscribersData = await request(`${FIREBASE_DB_BASE}/telegramSubscribers.json`) || {};
    const subscriberIds = Object.keys(subscribersData);

    const now = Date.now();

    for (const dateKey of datesToCheck) {
      let bookingsData;
      try {
        bookingsData = await request(`${FIREBASE_DB_BASE}/bookings/${dateKey}.json`) || {};
      } catch (e) {
        continue;
      }
      if (typeof bookingsData !== 'object' || bookingsData === null) continue;

      for (const [id, b] of Object.entries(bookingsData)) {
        if (!b || !b.status) continue;

        // ── New Confirmed Booking Notification ───────────────────────────────
        if (b.status === 'confirmed') {
          const confirmedKey = `${id}_confirmed`;
          if (!notifiedKeys.has(confirmedKey)) {
            notifiedKeys.add(confirmedKey);

            // Only broadcast if booking was confirmed AFTER the bot started
            const bookingTs = b.confirmedAt || b.createdAt || 0;
            if (subscriberIds.length > 0 && bookingTs >= botStartTimestamp) {
              const start12 = to12H(b.startTime);
              const end12   = to12H(b.endTime);
              const msg = `
⚽ <b>✅ حجز مؤكد جديد | ملعب الأحمدية</b>

تم تأكيد حجز موعد في الملعب!
📅 <b>التاريخ:</b> ${dateKey}
⏰ <b>الوقت:</b> ${start12} ← ${end12}
👤 <b>الحاجز:</b> ${b.customerName || 'فريق رياضي'}
🌙 <b>الفترة:</b> ${b.period || 'ملعب خماسي'}
${b.phone ? `📞 <b>الهاتف:</b> ${b.phone}` : ''}

📍 <i>مركز شباب الأحمدية - مركز المنزلة</i>
              `.trim();

              console.log(`[Bot] Broadcasting confirmed booking ${id} to ${subscriberIds.length} subscribers`);
              for (const cId of subscriberIds) {
                await sendTelegramMessage(cId, msg).catch(() => {});
              }
            }
          }

          // ── Expiry Notification ─────────────────────────────────────────────
          if (now >= b.endTimestamp && !b.expiredBroadcast) {
            await request(
              `${FIREBASE_DB_BASE}/bookings/${dateKey}/${id}.json`,
              { method: 'PATCH' },
              { expiredBroadcast: true }
            ).catch(() => {});

            if (subscriberIds.length > 0) {
              const msg = `
⏰ <b>انتهاء وقت المباراة | ملعب الأحمدية</b>

انتهت فترة المباراة المسجلة:
⏰ ${to12H(b.startTime)} ← ${to12H(b.endTime)}
👤 ${b.customerName || 'فريق رياضي'}
📅 ${dateKey}

🟢 الملعب جاهز الآن للفريق القادم.
              `.trim();

              console.log(`[Bot] Broadcasting expiry for booking ${id}`);
              for (const cId of subscriberIds) {
                await sendTelegramMessage(cId, msg).catch(() => {});
              }
            }
          }
        }

        // ── New Pending Booking Notification (to alert admin) ────────────────
        if (b.status === 'pending') {
          const pendingKey = `${id}_pending`;
          if (!notifiedKeys.has(pendingKey)) {
            notifiedKeys.add(pendingKey);

            const bookingTs = b.createdAt || 0;
            if (subscriberIds.length > 0 && bookingTs >= botStartTimestamp) {
              const start12 = to12H(b.startTime);
              const end12   = to12H(b.endTime);
              const msg = `
📋 <b>⏳ طلب حجز جديد بانتظار التأكيد | ملعب الأحمدية</b>

وصل طلب حجز جديد ويحتاج موافقة الإدارة:
📅 <b>التاريخ:</b> ${dateKey}
⏰ <b>الوقت:</b> ${start12} ← ${end12}
👤 <b>الاسم:</b> ${b.customerName || 'غير محدد'}
${b.phone ? `📞 <b>الهاتف:</b> ${b.phone}` : ''}

🔗 لتأكيده ادخل لوحة الإدارة:
https://mohamednasr5.github.io/hagz/admin/
              `.trim();

              console.log(`[Bot] Broadcasting pending booking ${id} to ${subscriberIds.length} subscribers`);
              for (const cId of subscriberIds) {
                await sendTelegramMessage(cId, msg).catch(() => {});
              }
            }
          }
        }
      }
    }

  } catch (err) {
    console.error('[Bot] Error in booking notification watcher:', err.message);
  }

  setTimeout(checkBookingNotifications, 10000); // Check every 10 seconds
}

// Start bot
pollTelegramUpdates();
checkBookingNotifications();


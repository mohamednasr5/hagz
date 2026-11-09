/**
 * bookingScheduler.js - Server-Side Booking Expiration Detector
 * Executes periodically to detect expired bookings even if no client browser is open.
 * Dispatches Telegram notifications and records expiration timestamps in database.
 */

const admin = require('firebase-admin');
const { notifyBookingExpired } = require('./telegram');

async function checkBookingExpirations() {
  const now = Date.now();
  // Egypt Date Key
  const todayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

  const bookingsRef = admin.database().ref(`bookings/${todayKey}`);
  const snap = await bookingsRef.once('value');
  const bookings = snap.val() || {};

  for (const [bookingId, b] of Object.entries(bookings)) {
    if (b.status === 'confirmed' && now >= b.endTimestamp && !b.expiredNotified) {
      console.log(`Booking expired for ${b.customerName} on ${todayKey} (${bookingId})`);

      // Mark expired in database atomically
      await admin.database().ref(`bookings/${todayKey}/${bookingId}`).update({
        expiredNotified: true,
        expiredAt: now,
        updatedAt: now
      });

      // Send Telegram Notification
      await notifyBookingExpired(b);

      // Audit Log
      await admin.database().ref('auditLogs').push({
        action: 'انتهاء وقت حجز تلقائياً',
        detail: `انتهى وقت حجز ${b.customerName} للفترة ${b.startTime} - ${b.endTime}`,
        timestamp: now
      });
    }
  }
}

module.exports = {
  checkBookingExpirations
};

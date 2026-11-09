/**
 * index.js - Firebase Cloud Functions Entry Point
 * Ahmadiah Pitch Manager Server-Side Operations
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const { 
  handleTelegramUpdate, 
  notifyBookingConfirmed, 
  notifyBookingCancelled 
} = require('./telegram');

const { checkBookingExpirations } = require('./bookingScheduler');

/**
 * HTTP Webhook for Telegram Bot Updates
 */
exports.telegramWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Telegram Webhook Ready');
  }

  try {
    await handleTelegramUpdate(req.body);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Database Trigger on Booking Change
 * Automatically notifies subscribers when a booking status changes to 'confirmed' or 'cancelled'
 */
exports.onBookingUpdated = functions.database
  .ref('/bookings/{date}/{bookingId}')
  .onWrite(async (change, context) => {
    const before = change.before.val();
    const after = change.after.val();

    // If booking was just confirmed
    if (after && after.status === 'confirmed' && (!before || before.status !== 'confirmed')) {
      await notifyBookingConfirmed(after);
    }

    // If booking was cancelled
    if (after && after.status === 'cancelled' && before && before.status === 'confirmed') {
      await notifyBookingCancelled(after);
    }

    return null;
  });

/**
 * Scheduled Cron Function: Checks for expired matches every 2 minutes
 */
exports.scheduledBookingExpiry = functions.pubsub
  .schedule('every 2 minutes')
  .timeZone('Africa/Cairo')
  .onRun(async (context) => {
    await checkBookingExpirations();
    return null;
  });

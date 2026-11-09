/**
 * schedule.js - Real-time Schedule Rendering & State Management
 * Subscribes to Firebase Realtime Database, computes slot states (Green, Red, Orange, Yellow),
 * coordinates active match spotlights and live countdowns.
 */

import { dbRefs, onValue } from './firebase-config.js';
import { 
  formatTimeArabic, 
  formatCurrency, 
  calculateBookingPrice, 
  timeStringToMinutes 
} from './utils.js';
import { openBookingModal, getPitchSettings } from './booking.js';
import { countdownEngine } from './countdown.js';

let activeDateListenerUnsubscribe = null;
let currentDayBookings = {};
let selectedDateKey = '';

/**
 * Loads schedule for a specific date
 */
export function loadScheduleForDate(dateKey) {
  selectedDateKey = dateKey;

  // Unsubscribe previous date listener if any
  if (activeDateListenerUnsubscribe) {
    activeDateListenerUnsubscribe();
    activeDateListenerUnsubscribe = null;
  }

  const dateRef = dbRefs.bookings(dateKey);
  const container = document.getElementById('slotsContainer');
  if (container) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #94a3b8;">
        <div style="font-size: 1.5rem; margin-bottom: 8px;">⏳</div>
        <div>جارٍ تحميل جدول المواعيد وتحديث الحالة لحظياً...</div>
      </div>
    `;
  }

  // Subscribe to real-time changes
  activeDateListenerUnsubscribe = onValue(dateRef, (snapshot) => {
    currentDayBookings = snapshot.val() || {};
    renderSlots();
    evaluateActiveSpotlightMatch();
  }, (err) => {
    console.error('Realtime schedule listener error:', err);
    if (container) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #ef4444;">
          تعذر الاتصال بقاعدة البيانات. يرجى التحقق من اتصال الإنترنت.
        </div>
      `;
    }
  });
}

/**
 * Generates slot hours (e.g. 08:00 to 01:00 next day - standard pitch hours)
 */
function getDaySlotHours() {
  const hours = [];
  // Standard operating hours: from 09:00 to 01:00 AM (next day)
  for (let h = 9; h <= 23; h++) {
    hours.push({
      startHour: h,
      endHour: (h + 1) % 24,
      startTime: `${String(h).padStart(2, '0')}:00`,
      endTime: `${String((h + 1) % 24).padStart(2, '0')}:00`
    });
  }
  // 00:00 to 01:00 AM
  hours.push({
    startHour: 0,
    endHour: 1,
    startTime: '00:00',
    endTime: '01:00'
  });
  return hours;
}

/**
 * Renders all slots in the grid with real-time status colors
 */
export function renderSlots() {
  const container = document.getElementById('slotsContainer');
  if (!container) return;

  const slots = getDaySlotHours();
  const settings = getPitchSettings();
  const now = Date.now();

  let html = '';

  slots.forEach((slot, index) => {
    const slotStartMin = timeStringToMinutes(slot.startTime);
    const slotEndMin = slotStartMin + 60;

    // Check if any booking covers this slot
    let matchedBooking = null;
    let matchedBookingId = null;

    for (const [id, b] of Object.entries(currentDayBookings)) {
      if (b.status === 'cancelled') continue;

      const bStartMin = timeStringToMinutes(b.startTime);
      const bDuration = Number(b.durationMinutes) || 60;
      const bEndMin = bStartMin + bDuration;

      // Overlap condition
      if (slotStartMin >= bStartMin && slotStartMin < bEndMin) {
        matchedBooking = b;
        matchedBookingId = id;
        break;
      }
    }

    // Determine status & visual classes
    let status = 'available'; // Default GREEN
    let statusLabel = 'قابل للحجز';
    let statusClass = 'status-available';
    let pillClass = 'status-pill-green';
    let isClickable = true;

    const pricing = calculateBookingPrice(slot.startTime, 1, settings);
    const isNight = pricing.nightHours > 0;
    const periodTag = isNight 
      ? '<span class="slot-period-tag period-night">🌙 ليلي</span>' 
      : '<span class="slot-period-tag period-day">☀️ نهاري</span>';

    if (matchedBooking) {
      isClickable = false;
      const isConfirmed = matchedBooking.status === 'confirmed';
      const isPending = matchedBooking.status === 'pending';

      const isCurrentTime = now >= matchedBooking.startTimestamp && now < matchedBooking.endTimestamp;
      const isPastTime = now >= matchedBooking.endTimestamp;

      if (isPending) {
        // YELLOW: في انتظار التأكيد
        status = 'pending';
        statusLabel = 'في انتظار التأكيد';
        statusClass = 'status-pending';
        pillClass = 'status-pill-yellow';
      } else if (isConfirmed) {
        if (isPastTime) {
          // ORANGE: انتهى الحجز
          status = 'expired';
          statusLabel = 'انتهى الحجز';
          statusClass = 'status-expired';
          pillClass = 'status-pill-orange';
        } else {
          // RED: محجوز
          status = 'booked';
          statusLabel = isCurrentTime ? '🔴 جاري الآن' : 'محجوز';
          statusClass = 'status-booked';
          pillClass = 'status-pill-red';
        }
      }
    }

    const cardId = `slot-card-${index}`;

    html += `
      <div id="${cardId}" class="slot-card ${statusClass}" data-start="${slot.startTime}" data-date="${selectedDateKey}">
        <div class="slot-top-row">
          <div class="slot-time">
            <span>${slot.startTime}</span>
            <span style="color: var(--text-muted); font-size: 0.9rem;">إلى</span>
            <span>${slot.endTime}</span>
          </div>
          ${periodTag}
        </div>

        <div class="slot-details-body">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="slot-status-pill ${pillClass}">
              ● ${statusLabel}
            </span>
            <span class="slot-price-info">
              ${formatCurrency(pricing.total)} / ساعة
            </span>
          </div>

          ${matchedBooking ? `
            <div class="customer-tag">
              👤 ${escapeHtml(matchedBooking.customerName || 'محجوز')}
            </div>
            ${matchedBooking.notes ? `<div style="font-size: 0.78rem; color: #94a3b8;">📝 ${escapeHtml(matchedBooking.notes)}</div>` : ''}
          ` : `
            <div style="font-size: 0.8rem; color: #94a3b8;">
              الملعب متاح ومضاء وجاهز للحجز
            </div>
          `}
        </div>

        <div class="slot-action-area">
          ${isClickable ? `
            <button class="btn-book-slot" onclick="window.handleSlotBookClick('${selectedDateKey}', '${slot.startTime}')">
              <span>⚡ احجز الآن</span>
            </button>
          ` : `
            <div style="text-align: center; font-size: 0.82rem; color: #94a3b8; padding: 6px 0;">
              ${statusLabel}
            </div>
          `}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

/**
 * Evaluates whether there is currently an ongoing match right now and mounts countdown
 */
function evaluateActiveSpotlightMatch() {
  const spotlightCard = document.getElementById('activeMatchCard');
  if (!spotlightCard) return;

  const now = Date.now();
  let ongoingBooking = null;
  let ongoingId = null;

  for (const [id, b] of Object.entries(currentDayBookings)) {
    if (b.status === 'confirmed' && now >= b.startTimestamp && now < b.endTimestamp) {
      ongoingBooking = b;
      ongoingId = id;
      break;
    }
  }

  if (ongoingBooking) {
    spotlightCard.classList.add('visible');

    document.getElementById('activeCustomerName').textContent = ongoingBooking.customerName || 'مباراة نشطة';
    document.getElementById('activeMatchTime').textContent = `${ongoingBooking.startTime} إلى ${ongoingBooking.endTime}`;
    document.getElementById('activeMatchPeriod').textContent = ongoingBooking.period || 'ملعب خماسي';

    // Register countdown engine
    countdownEngine.register(
      ongoingId,
      ongoingBooking.startTimestamp,
      ongoingBooking.endTimestamp,
      (data) => {
        const hEl = document.getElementById('countHours');
        const mEl = document.getElementById('countMinutes');
        const sEl = document.getElementById('countSeconds');
        if (hEl) hEl.textContent = data.hours;
        if (mEl) mEl.textContent = data.minutes;
        if (sEl) sEl.textContent = data.seconds;

        const progressFill = document.getElementById('activeMatchProgressFill');
        if (progressFill) progressFill.style.width = `${data.progress}%`;
      },
      () => {
        // Expiration handler
        renderSlots();
        evaluateActiveSpotlightMatch();
      }
    );

  } else {
    spotlightCard.classList.remove('visible');
    // Unregister any active countdown
    if (ongoingId) {
      countdownEngine.unregister(ongoingId);
    }
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

// Global click handler exposed for slot cards
window.handleSlotBookClick = function(dateKey, startTime) {
  openBookingModal(dateKey, startTime, 1);
};

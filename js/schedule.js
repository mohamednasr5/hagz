/**
 * schedule.js - Real-time Schedule Rendering & State Management
 * Subscribes to Firebase Realtime Database, computes slot states (Green, Red, Orange, Yellow),
 * coordinates active match spotlights and live countdowns.
 */

import { dbRefs, onValue } from './firebase-config.js';
import { 
  formatTimeArabic, 
  formatTime12H,
  formatSlotRange12H,
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
 * Renders both the Tactical Football Pitch Formation and the Slots Grid
 */
export function renderSlots() {
  const slots = getDaySlotHours();
  const settings = getPitchSettings();
  const now = Date.now();

  // Compute status for all slots
  const evaluatedSlots = slots.map((slot, index) => {
    const slotStartMin = timeStringToMinutes(slot.startTime);
    let matchedBooking = null;
    let matchedBookingId = null;

    for (const [id, b] of Object.entries(currentDayBookings)) {
      if (b.status === 'cancelled') continue;
      const bStartMin = timeStringToMinutes(b.startTime);
      const bDuration = Number(b.durationMinutes) || 60;
      const bEndMin = bStartMin + bDuration;

      if (slotStartMin >= bStartMin && slotStartMin < bEndMin) {
        matchedBooking = b;
        matchedBookingId = id;
        break;
      }
    }

    let status = 'available'; // Default GREEN
    let statusLabel = 'قابل للحجز';
    let statusClass = 'status-available';
    let nodeClass = 'status-node-green';
    let pillClass = 'status-pill-green';
    let isClickable = true;

    const pricing = calculateBookingPrice(slot.startTime, 1, settings);
    const isNight = pricing.nightHours > 0;

    if (matchedBooking) {
      isClickable = false;
      const isConfirmed = matchedBooking.status === 'confirmed';
      const isPending = matchedBooking.status === 'pending';
      const isCurrentTime = now >= matchedBooking.startTimestamp && now < matchedBooking.endTimestamp;
      const isPastTime = now >= matchedBooking.endTimestamp;

      if (isPending) {
        status = 'pending';
        statusLabel = 'في انتظار التأكيد';
        statusClass = 'status-pending';
        nodeClass = 'status-node-yellow';
        pillClass = 'status-pill-yellow';
      } else if (isConfirmed) {
        if (isPastTime) {
          status = 'expired';
          statusLabel = 'انتهى الحجز';
          statusClass = 'status-expired';
          nodeClass = 'status-node-orange';
          pillClass = 'status-pill-orange';
        } else {
          status = 'booked';
          statusLabel = isCurrentTime ? '🔴 جاري الآن' : 'محجوز';
          statusClass = 'status-booked';
          nodeClass = 'status-node-red';
          pillClass = 'status-pill-red';
        }
      }
    }

    return {
      slot,
      index,
      status,
      statusLabel,
      statusClass,
      nodeClass,
      pillClass,
      isClickable,
      pricing,
      isNight,
      matchedBooking
    };
  });

  // 1. Render Tactical Pitch Formation (دوائر تشكيلة اللاعبين على أرضية الملعب)
  renderTacticalFormation(evaluatedSlots);

  // 2. Render Cards Grid
  renderCardsGrid(evaluatedSlots);
}

/**
 * Renders the Tactical Football Pitch with Circles
 */
function renderTacticalFormation(evaluatedSlots) {
  const container = document.getElementById('tacticalPitchFormation');
  if (!container) return;

  // Split into 4 tactical lines:
  // Line 1: الصباح (Slots 0 to 3: 09:00 ص - 12:00 م)
  // Line 2: الظهيرة والعصر (Slots 4 to 7: 01:00 م - 04:00 م)
  // Line 3: المغرب والعشاء (Slots 8 to 11: 05:00 م - 08:00 م)
  // Line 4: سهرة الكشافات (Slots 12 to 15: 09:00 م - 12:00 ص)
  const lines = [
    { title: '☀️ تشكيلة الصباح (09:00 ص - 01:00 م)', slots: evaluatedSlots.slice(0, 4) },
    { title: '☀️ تشكيلة الظهيرة والعصر (01:00 م - 05:00 م)', slots: evaluatedSlots.slice(4, 8) },
    { title: '🌅 تشكيلة المغرب وبداية المساء (05:00 م - 09:00 م)', slots: evaluatedSlots.slice(8, 12) },
    { title: '💡 تشكيلة سهرة الكشافات الليلية (09:00 م - 01:00 ص)', slots: evaluatedSlots.slice(12, 16) }
  ];

  let html = '';

  lines.forEach((line) => {
    html += `
      <div class="tactical-line-label">${line.title}</div>
      <div class="tactical-line-row">
    `;

    line.slots.forEach((item) => {
      const s = item.slot;
      const time12H = formatTime12H(s.startTime);
      const range12H = formatSlotRange12H(s.startTime, s.endTime);

      let tooltipCustomer = '';
      if (item.matchedBooking) {
        tooltipCustomer = `👤 ${escapeHtml(item.matchedBooking.customerName || 'محجوز')}`;
      } else {
        tooltipCustomer = `⚡ ${formatCurrency(item.pricing.total)} (انقر للحجز)`;
      }

      const clickHandler = item.isClickable 
        ? `onclick="window.handleSlotBookClick('${selectedDateKey}', '${s.startTime}')"` 
        : `onclick="window.handleCircleInfoClick('${time12H}', '${item.statusLabel}', '${item.matchedBooking ? escapeHtml(item.matchedBooking.customerName) : ''}')"`;

      html += `
        <div class="player-slot-circle ${item.nodeClass}" ${clickHandler} title="${range12H} - ${item.statusLabel}">
          <span class="node-icon">⚽</span>
          <span class="node-time-12h">${time12H}</span>
          <span class="node-subtext">${item.status === 'available' ? 'متاح' : item.statusLabel}</span>

          <div class="node-tooltip">
            <strong style="color: #38bdf8; font-size: 0.85rem;">${range12H}</strong>
            <span style="font-weight: 700;">${item.statusLabel}</span>
            <span style="color: #94a3b8; font-size: 0.75rem;">${tooltipCustomer}</span>
          </div>
        </div>
      `;
    });

    html += `</div>`;
  });

  container.innerHTML = html;
}

/**
 * Renders Standard Cards Grid with 12-Hour format
 */
function renderCardsGrid(evaluatedSlots) {
  const container = document.getElementById('slotsContainer');
  if (!container) return;

  let html = '';

  evaluatedSlots.forEach((item) => {
    const slot = item.slot;
    const range12H = formatSlotRange12H(slot.startTime, slot.endTime);
    const start12H = formatTime12H(slot.startTime);
    const end12H = formatTime12H(slot.endTime);

    const periodTag = item.isNight 
      ? '<span class="slot-period-tag period-night">🌙 ليلي</span>' 
      : '<span class="slot-period-tag period-day">☀️ نهاري</span>';

    const cardId = `slot-card-${item.index}`;

    html += `
      <div id="${cardId}" class="slot-card ${item.statusClass}" data-start="${slot.startTime}" data-date="${selectedDateKey}">
        <div class="slot-top-row">
          <div class="slot-time" style="font-size: 1.15rem; font-weight: 800; direction: rtl;">
            <span>${start12H}</span>
            <span style="color: var(--text-muted); font-size: 0.85rem; margin: 0 4px;">إلى</span>
            <span>${end12H}</span>
          </div>
          ${periodTag}
        </div>

        <div class="slot-details-body">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="slot-status-pill ${item.pillClass}">
              ● ${item.statusLabel}
            </span>
            <span class="slot-price-info">
              ${formatCurrency(item.pricing.total)} / ساعة
            </span>
          </div>

          ${item.matchedBooking ? `
            <div class="customer-tag">
              👤 ${escapeHtml(item.matchedBooking.customerName || 'محجوز')}
            </div>
            ${item.matchedBooking.notes ? `<div style="font-size: 0.78rem; color: #94a3b8;">📝 ${escapeHtml(item.matchedBooking.notes)}</div>` : ''}
          ` : `
            <div style="font-size: 0.8rem; color: #94a3b8;">
              الملعب متاح ومضاء وجاهز للحجز
            </div>
          `}
        </div>

        <div class="slot-action-area">
          ${item.isClickable ? `
            <button class="btn-book-slot" onclick="window.handleSlotBookClick('${selectedDateKey}', '${slot.startTime}')">
              <span>⚡ احجز الآن (${start12H})</span>
            </button>
          ` : `
            <div style="text-align: center; font-size: 0.85rem; color: #94a3b8; padding: 6px 0; font-weight: 700;">
              ${item.statusLabel}
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
    document.getElementById('activeMatchTime').textContent = formatSlotRange12H(ongoingBooking.startTime, ongoingBooking.endTime);
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

// Global click handler for non-available circles on tactical pitch
window.handleCircleInfoClick = function(timeStr, statusLabel, customerName) {
  const detail = customerName ? ` (${customerName})` : '';
  const { showToast } = import('./utils.js').then(u => {
    u.showToast(`موعد الساعة ${timeStr}: ${statusLabel}${detail}`, statusLabel.includes('محجوز') ? 'error' : 'info');
  });
};

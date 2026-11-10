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
import { soundFX } from './audio-fx.js';

let activeDateListenerUnsubscribe = null;
let currentDayBookings = {};
let selectedDateKey = '';

/* Keep the live pitch map and active-match panel aligned with the Cairo clock,
   including queued bookings that become active without a database write. */
setInterval(() => {
  if (selectedDateKey && isDateToday(selectedDateKey)) {
    renderSlots();
    evaluateActiveSpotlightMatch();
  }
}, 15000);

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
  for (let minute = 9 * 60; minute < 25 * 60; minute += 30) {
    const start = minute % 1440;
    const end = (minute + 30) % 1440;
    const toTime = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
    hours.push({
      startHour: Math.floor(start / 60),
      endHour: Math.floor(end / 60),
      startTime: toTime(start),
      endTime: toTime(end)
    });
  }
  return hours;
}

/**
 * Determines if a given date string (YYYY-MM-DD) is in the past (before today in Cairo TZ)
 */
function isDateInPast(dateKey) {
  const todayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  return dateKey < todayKey;
}

/**
 * Determines if a given date string (YYYY-MM-DD) is today in Cairo TZ
 */
function isDateToday(dateKey) {
  const todayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  return dateKey === todayKey;
}

/**
 * Returns current Cairo time as minutes-since-midnight
 */
function getNowMinutesCairo() {
  const cairoStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date());
  // cairoStr is e.g. "23:05" or "01:30"
  const [h, m] = cairoStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Renders both the Tactical Football Pitch Formation and the Slots Grid
 */
export function renderSlots() {
  const slots = getDaySlotHours();
  const settings = getPitchSettings();
  const now = Date.now();

  const pastDate   = isDateInPast(selectedDateKey);
  const todayDate  = isDateToday(selectedDateKey);
  const nowMinutes = getNowMinutesCairo();

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

      if (slotStartMin < bEndMin && slotStartMin + 30 > bStartMin) {
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

    const pricing = calculateBookingPrice(slot.startTime, 0.5, settings);
    const isNight = pricing.nightHours > 0;

    // ── PAST DATE: everything is expired and unclickable ──────────────────
    if (pastDate && !matchedBooking) {
      isClickable = false;
      status = 'expired';
      statusLabel = 'يوم منتهي';
      statusClass = 'status-expired';
      nodeClass = 'status-node-orange';
      pillClass = 'status-pill-orange';
      return { slot, index, status, statusLabel, statusClass, nodeClass, pillClass, isClickable, pricing, isNight, matchedBooking, matchedBookingId };
    }

    // ── TODAY: past time slots (time already gone) are expired/unclickable ──
    if (todayDate && !matchedBooking) {
      if (nowMinutes >= slotStartMin) {
        isClickable = false;
        status = 'expired';
        statusLabel = 'فات الوقت';
        statusClass = 'status-expired';
        nodeClass = 'status-node-orange';
        pillClass = 'status-pill-orange';
        return { slot, index, status, statusLabel, statusClass, nodeClass, pillClass, isClickable, pricing, isNight, matchedBooking };
      }
    }

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
      matchedBooking,
      matchedBookingId
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

  // Divide all half-hour periods into four readable time bands.
  const lines = [
    { title: '☀️ الفترة الصباحية (09:00 ص - 01:00 م)', slots: evaluatedSlots.filter(x => timeStringToMinutes(x.slot.startTime) < 13 * 60) },
    { title: '☀️ الظهيرة والعصر (01:00 م - 05:00 م)', slots: evaluatedSlots.filter(x => timeStringToMinutes(x.slot.startTime) >= 13 * 60 && timeStringToMinutes(x.slot.startTime) < 17 * 60) },
    { title: '🌅 الفترة المسائية (05:00 م - 09:00 م)', slots: evaluatedSlots.filter(x => timeStringToMinutes(x.slot.startTime) >= 17 * 60 && timeStringToMinutes(x.slot.startTime) < 21 * 60) },
    { title: '💡 الفترة الليلية (09:00 م - 01:00 ص)', slots: evaluatedSlots.filter(x => timeStringToMinutes(x.slot.startTime) >= 21 * 60) }
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
        tooltipCustomer = `👤 ${escapeHtml(item.matchedBooking.customerName || 'محجوز')} • ${Number(item.matchedBooking.durationMinutes) || 60} دقيقة • ${formatTime12H(item.matchedBooking.startTime)} إلى ${formatTime12H(item.matchedBooking.endTime)}`;
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
  const renderedBookingIds = new Set();

  evaluatedSlots.forEach((item) => {
    const slot = item.slot;
    const booking = item.matchedBooking;
    const bookingId = item.matchedBookingId;

    // A single booking can overlap several half-hour slots. Render its full
    // reservation once, not once for every half-hour segment it occupies.
    if (booking && bookingId) {
      if (renderedBookingIds.has(bookingId)) return;
      renderedBookingIds.add(bookingId);
    }

    const displayStart = booking ? booking.startTime : slot.startTime;
    const displayEnd = booking ? booking.endTime : slot.endTime;
    const range12H = formatSlotRange12H(displayStart, displayEnd);
    const start12H = formatTime12H(displayStart);
    const end12H = formatTime12H(displayEnd);

    const bookingDurationMinutes = booking
      ? Number(booking.durationMinutes) || Math.max(30,
          timeStringToMinutes(booking.endTime) - timeStringToMinutes(booking.startTime))
      : 30;
    const bookingDurationHours = bookingDurationMinutes / 60;
    const bookingPricing = booking
      ? calculateBookingPrice(booking.startTime, bookingDurationHours, getPitchSettings())
      : item.pricing;
    const bookingIsNight = booking
      ? bookingPricing.nightHours > 0
      : item.isNight;

    const periodTag = booking
      ? (booking.period && booking.period.includes('ليل')
          ? '<span class="slot-period-tag period-night">🌙 ليلي</span>'
          : booking.period && booking.period.includes('نهار')
            ? '<span class="slot-period-tag period-day">☀️ نهاري</span>'
            : bookingIsNight
              ? '<span class="slot-period-tag period-night">🌙 ليلي</span>'
              : '<span class="slot-period-tag period-day">☀️ نهاري</span>')
      : (item.isNight
          ? '<span class="slot-period-tag period-night">🌙 ليلي</span>'
          : '<span class="slot-period-tag period-day">☀️ نهاري</span>');

    const cardId = booking && bookingId
      ? `booking-card-${bookingId}`
      : `slot-card-${item.index}`;

    html += `
      <div id="${cardId}" class="slot-card ${item.statusClass}" data-start="${displayStart}" data-date="${selectedDateKey}" ${bookingId ? `data-booking-id="${bookingId}"` : ''}>
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

          ${booking ? `
            <div class="customer-tag">
              👤 ${escapeHtml(booking.customerName || 'محجوز')}
            </div>
            <div style="font-size:0.78rem;color:#fca5a5;font-weight:700;">⏱ المدة: ${bookingDurationMinutes} دقيقة</div>
            <div style="font-size:0.78rem;color:#cbd5e1;">من ${start12H} إلى ${end12H}</div>
            ${booking.notes ? `<div style="font-size: 0.78rem; color: #94a3b8;">📝 ${escapeHtml(booking.notes)}</div>` : ''}
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
    document.getElementById('activeMatchPeriod').textContent = (ongoingBooking.period || 'ملعب خماسي') + ' • ' + (Number(ongoingBooking.durationMinutes) || 60) + ' دقيقة';

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
  soundFX.playClick();
  openBookingModal(dateKey, startTime, 1);
};

// Global click handler for non-available circles on tactical pitch
window.handleCircleInfoClick = function(timeStr, statusLabel, customerName) {
  soundFX.playError();
  const detail = customerName ? ` (${customerName})` : '';
  const { showToast } = import('./utils.js').then(u => {
    u.showToast(`موعد الساعة ${timeStr}: ${statusLabel}${detail}`, statusLabel.includes('محجوز') ? 'error' : 'info');
  });
};

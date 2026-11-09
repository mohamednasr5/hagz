/**
 * utils.js - Ahmadiah Pitch Manager Utilities
 * Handles Egypt Timezone (Africa/Cairo), Day/Night split calculations,
 * currency formatting, and UI helpers.
 */

export const EGYPT_TIMEZONE = 'Africa/Cairo';

/**
 * Gets current Egypt Date object
 */
export function getEgyptNow() {
  const now = new Date();
  const cairoString = now.toLocaleString('en-US', { timeZone: EGYPT_TIMEZONE });
  return new Date(cairoString);
}

/**
 * Formats a Date object into YYYY-MM-DD in Egypt timezone
 */
export function formatEgyptDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: EGYPT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
  return parts; // Returns YYYY-MM-DD
}

/**
 * Formats Arabic Day Name (e.g. "الجمعة")
 */
export function getArabicDayName(date = new Date()) {
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: EGYPT_TIMEZONE,
    weekday: 'long'
  }).format(date);
}

/**
 * Formats full Arabic Date string (e.g. "9 نوفمبر 2026")
 */
export function formatArabicFullDate(date = new Date()) {
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: EGYPT_TIMEZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

/**
 * Formats Egyptian Currency (e.g. "150 ج.م")
 */
export function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return `${num.toLocaleString('ar-EG')} ج.م`;
}

/**
 * Converts "17:00" to "5:00 م" (12-hour Arabic format)
 */
export function formatTime12H(time24) {
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
 * Converts start and end 24H times to 12H range "05:00 م - 06:00 م"
 */
export function formatSlotRange12H(startTime, endTime) {
  return `${formatTime12H(startTime)} - ${formatTime12H(endTime)}`;
}

/** Create 30-minute choices; values stay canonical HH:mm while labels use 12-hour time. */
export function buildTimeOptions(startHour = 9, endHour = 24, stepMinutes = 30) {
  const options = [];
  for (let minute = startHour * 60; minute <= endHour * 60; minute += stepMinutes) {
    const normalized = minute % 1440;
    const hour = Math.floor(normalized / 60);
    const mins = normalized % 60;
    const value = `${String(hour).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    options.push({ value, label: formatTime12H(value) });
  }
  return options;
}

export function populateTimeSelect(select, selectedValue = '09:00') {
  if (!select) return;
  select.innerHTML = buildTimeOptions().map(({ value, label }) =>
    `<option value="${value}">${label}</option>`
  ).join('');
  select.value = selectedValue;
  if (select.value !== selectedValue) select.selectedIndex = 0;
}
/** Build a half-hour time list with canonical 24-hour values and 12-hour labels. */
export function buildTimeOptions(startHour = 9, endHour = 24, stepMinutes = 30) {
  const options = [];
  for (let minute = startHour * 60; minute <= endHour * 60; minute += stepMinutes) {
    const normalized = minute % 1440;
    const hour = Math.floor(normalized / 60);
    const mins = normalized % 60;
    const value = `${String(hour).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    options.push({ value, label: formatTime12H(value) });
  }
  return options;
}

export function populateTimeSelect(select, selectedValue = '09:00') {
  if (!select) return;
  const options = buildTimeOptions(9, 24, 30);
  select.innerHTML = options.map(({ value, label }) =>
    `<option value="${value}">${label}</option>`
  ).join('');
  select.value = selectedValue;
  if (select.value !== selectedValue) select.selectedIndex = 0;
}

/**
 * Converts 24-hour time "14:00" or 14 to Arabic 12-hour display "02:00 م"
 */
export function formatTimeArabic(hour, minute = 0) {
  const h = Number(hour);
  const m = String(minute).padStart(2, '0');
  const period = h >= 12 ? 'م' : 'ص';
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${String(displayHour).padStart(2, '0')}:${m} ${period}`;
}

/**
 * Parses "HH:mm" to minutes since midnight
 */
export function timeStringToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Calculates Day & Night Price Breakdown
 * Even if a booking crosses the boundary (e.g., 5:00 PM to 7:00 PM when night starts at 6:00 PM)
 * 
 * @param {string} startTime - "HH:mm" (e.g. "17:00")
 * @param {number} durationHours - Booking duration in hours (e.g. 2)
 * @param {Object} settings - { dayPrice, nightPrice, dayStart: "06:00", nightStart: "18:00" }
 * @returns {Object} { dayHours, nightHours, dayTotal, nightTotal, total, periodLabel }
 */
export function calculateBookingPrice(startTime, durationHours, settings) {
  const dayPrice = Number(settings.dayPrice) || 100;
  const nightPrice = Number(settings.nightPrice) || 150;
  const nightStartMin = timeStringToMinutes(settings.nightStart || '18:00');
  const dayStartMin = timeStringToMinutes(settings.dayStart || '06:00');

  const startMin = timeStringToMinutes(startTime);
  const totalMinutes = durationHours * 60;
  const endMin = startMin + totalMinutes;

  let dayMinutes = 0;
  let nightMinutes = 0;

  // Iterate minute by minute or in 15-min chunks to accurately partition
  for (let m = startMin; m < endMin; m++) {
    const wrappedMin = m % (24 * 60);
    // Daytime is between dayStart and nightStart
    const isDay = wrappedMin >= dayStartMin && wrappedMin < nightStartMin;
    if (isDay) {
      dayMinutes++;
    } else {
      nightMinutes++;
    }
  }

  const dayHours = dayMinutes / 60;
  const nightHours = nightMinutes / 60;

  const dayTotal = Math.round(dayHours * dayPrice);
  const nightTotal = Math.round(nightHours * nightPrice);
  const total = dayTotal + nightTotal;

  let periodLabel = 'نهاري';
  if (nightHours > 0 && dayHours === 0) {
    periodLabel = 'ليلي';
  } else if (nightHours > 0 && dayHours > 0) {
    periodLabel = 'مختلط (نهاري / ليلي)';
  }

  return {
    dayHours: Number(dayHours.toFixed(1)),
    nightHours: Number(nightHours.toFixed(1)),
    dayTotal,
    nightTotal,
    total,
    periodLabel
  };
}

/**
 * Toast Notification Popup Helper
 */
export function showToast(message, type = 'info') {
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.style.cssText = `
      position: fixed;
      bottom: 90px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    `;
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  const bg = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6';
  toast.style.cssText = `
    background: ${bg};
    color: #fff;
    padding: 10px 20px;
    border-radius: 30px;
    font-weight: 700;
    font-size: 0.9rem;
    box-shadow: 0 4px 15px rgba(0,0,0,0.4);
    opacity: 0;
    transform: translateY(10px);
    transition: all 0.3s ease;
    direction: rtl;
    text-align: center;
  `;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

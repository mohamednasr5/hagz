/**
 * booking.js - Booking Logic & Atomic Submission
 * Handles booking modal, pricing calculation, customer submission, and atomic concurrency checks.
 */

import { 
  db, 
  dbRefs, 
  push, 
  set, 
  get, 
  runTransaction 
} from './firebase-config.js';
import { 
  calculateBookingPrice, 
  formatCurrency, 
  showToast, 
  timeStringToMinutes,
  populateTimeSelect
} from './utils.js';
import { soundFX } from './audio-fx.js';

let currentSettings = {
  pitchName: 'ملعب مركز شباب الأحمدية الخماسي',
  dayPrice: 120,
  nightPrice: 180,
  dayStart: '06:00',
  nightStart: '18:00',
  bookingEnabled: true
};

export function setPitchSettings(settings) {
  if (settings) {
    currentSettings = { ...currentSettings, ...settings };
  }
}

export function getPitchSettings() {
  return currentSettings;
}

/**
 * Initializes Booking Modal event listeners
 */
export function initBookingModal() {
  const modalOverlay = document.getElementById('bookingModal');
  const closeBtn = document.getElementById('closeBookingModalBtn');
  const cancelBtn = document.getElementById('cancelBookingModalBtn');
  const form = document.getElementById('bookingForm');
  const durationSelect = document.getElementById('bookingDuration');
  const startTimeInput = document.getElementById('bookingStartTime');

  if (!modalOverlay) return;
  populateTimeSelect(startTimeInput, '09:00');

  const closeModal = () => {
    modalOverlay.classList.remove('active');
    if (form) form.reset();
  };

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  // Close on backdrop click
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // Re-calculate price on duration or start time change
  if (durationSelect) {
    durationSelect.addEventListener('change', updateModalPricingPreview);
  }
  if (startTimeInput) {
    startTimeInput.addEventListener('change', updateModalPricingPreview);
  }

  // Form submission
  if (form) {
    form.addEventListener('submit', handleBookingSubmit);
  }
}

/**
 * Opens booking modal for a specific slot
 */
export function openBookingModal(dateKey, startTime, defaultDuration = 1) {
  const modalOverlay = document.getElementById('bookingModal');
  if (!modalOverlay) return;

  if (currentSettings.bookingEnabled === false) {
    soundFX.playError();
    showToast('الحجز معطل حالياً من قِبل إدارة الملعب.', 'error');
    return;
  }

  // Verify Date is not in the past
  const todayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());

  if (dateKey < todayKey) {
    soundFX.playError();
    showToast('عذراً، هذا اليوم قد انتهى بالفعل ولا يمكن الحجز فيه!', 'error');
    return;
  }

  // If today, verify start time is not already in the past
  if (dateKey === todayKey) {
    const cairoStr = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date());
    const [ch, cm] = cairoStr.split(':').map(Number);
    const nowMinutes = ch * 60 + cm;
    const startMinutes = timeStringToMinutes(startTime);
    const adjStartMin = startMinutes === 0 ? 24 * 60 : startMinutes;

    if (nowMinutes >= adjStartMin) {
      soundFX.playError();
      showToast('عذراً، هذه الساعة قد مضى وقتها بالفعل اليوم!', 'error');
      return;
    }
  }

  soundFX.playModalOpen();
  document.getElementById('bookingDate').value = dateKey;
  document.getElementById('bookingDateDisplay').textContent = dateKey;
  document.getElementById('bookingStartTime').value = startTime;
  document.getElementById('bookingDuration').value = defaultDuration;

  updateModalPricingPreview();
  modalOverlay.classList.add('active');
}

/**
 * Updates price breakdown live inside the modal
 */
export function updateModalPricingPreview() {
  const startTime = document.getElementById('bookingStartTime').value;
  const duration = Number(document.getElementById('bookingDuration').value) || 1;

  const breakdown = calculateBookingPrice(startTime, duration, currentSettings);

  const dayHoursEl = document.getElementById('previewDayHours');
  const nightHoursEl = document.getElementById('previewNightHours');
  const dayPriceEl = document.getElementById('previewDayPrice');
  const nightPriceEl = document.getElementById('previewNightPrice');
  const totalPriceEl = document.getElementById('previewTotalPrice');
  const periodTagEl = document.getElementById('previewPeriodTag');

  if (dayHoursEl) dayHoursEl.textContent = `${breakdown.dayHours} ساعة`;
  if (nightHoursEl) nightHoursEl.textContent = `${breakdown.nightHours} ساعة`;
  if (dayPriceEl) dayPriceEl.textContent = formatCurrency(breakdown.dayTotal);
  if (nightPriceEl) nightPriceEl.textContent = formatCurrency(breakdown.nightTotal);
  if (totalPriceEl) totalPriceEl.textContent = formatCurrency(breakdown.total);
  if (periodTagEl) periodTagEl.textContent = breakdown.periodLabel;
}

/**
 * Handles Form Submission with Concurrency Checking
 */
async function handleBookingSubmit(e) {
  e.preventDefault();

  const submitBtn = document.getElementById('submitBookingBtn');
  const originalText = submitBtn ? submitBtn.textContent : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'جارٍ تسجيل الطلب...';
  }

  try {
    const customerName = document.getElementById('customerName').value.trim();
    const customerPhone = document.getElementById('customerPhone').value.trim();
    const date = document.getElementById('bookingDate').value;
    const startTime = document.getElementById('bookingStartTime').value;
    const duration = Number(document.getElementById('bookingDuration').value) || 1;
    const notes = document.getElementById('bookingNotes').value.trim();

    if (!customerName) {
      soundFX.playError();
      showToast('يرجى إدخال اسم العميل أو اسم الفريق', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
      return;
    }

    // ── Check past date or past hour ───────────────────────────────────────
    const todayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());

    if (date < todayKey) {
      soundFX.playError();
      showToast('عذراً، لا يمكن تسجيل حجز لتاريخ ماضٍ انتهى!', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
      return;
    }

    if (date === todayKey) {
      const cairoStr = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Cairo',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date());
      const [ch, cm] = cairoStr.split(':').map(Number);
      const nowMinutes = ch * 60 + cm;
      const startMinutesVal = timeStringToMinutes(startTime);
      const adjStartMin = startMinutesVal === 0 ? 24 * 60 : startMinutesVal;

      if (nowMinutes >= adjStartMin) {
        soundFX.playError();
        showToast('عذراً، هذه الساعة قد مضت بالفعل اليوم ولا يمكن حجزها!', 'error');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
        }
        return;
      }
    }

    const startMinutes = timeStringToMinutes(startTime);
    const durationMinutes = Math.round(duration * 60);
    if (!Number.isFinite(durationMinutes) || durationMinutes < 30 || durationMinutes % 30 !== 0) {
      soundFX.playError();
      showToast('مدة الحجز يجب أن تكون 30 دقيقة على الأقل وبمضاعفات نصف ساعة.', 'error');
      return;
    }
    const endMinutes = startMinutes + durationMinutes;
    const breakdown = calculateBookingPrice(startTime, duration, currentSettings);

    // Compute exact startTimestamp and endTimestamp
    const [y, m, d] = date.split('-').map(Number);
    const [sh, sm] = startTime.split(':').map(Number);
    const startDateObj = new Date(y, m - 1, d, sh, sm, 0);
    const startTimestamp = startDateObj.getTime();
    const endTimestamp = startTimestamp + (durationMinutes * 60 * 1000);

    // End time string
    const endH = Math.floor(endMinutes / 60) % 24;
    const endM = endMinutes % 60;
    const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

    // Atomic conflict verification against bookings on this date
    const dateBookingsRef = dbRefs.bookings(date);
    const snapshot = await get(dateBookingsRef);
    const existingBookings = snapshot.val() || {};

    let hasConflict = false;
    for (const [id, b] of Object.entries(existingBookings)) {
      if (b.status === 'confirmed' || b.status === 'pending') {
        const bStartMin = timeStringToMinutes(b.startTime);
        const bEndMin = bStartMin + (b.durationMinutes || 60);

        // Check if times overlap: (start1 < end2) && (end1 > start2)
        if (startMinutes < bEndMin && endMinutes > bStartMin) {
          hasConflict = true;
          break;
        }
      }
    }

    if (hasConflict) {
      soundFX.playError();
      showToast('عذراً! هذه الفترة متداخلة مع حجز آخر مسجل بالفعل.', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
      return;
    }

    // Push new booking request
    const newBookingRef = push(dateBookingsRef);
    const bookingData = {
      bookingId: newBookingRef.key,
      customerName,
      customerPhone: customerPhone || 'غير مسجل',
      phone: customerPhone || '',
      date,
      startTime,
      endTime,
      durationMinutes,
      period: breakdown.periodLabel,
      startTimestamp,
      endTimestamp,
      totalPrice: breakdown.total,
      paidAmount: 0,
      remainingAmount: breakdown.total,
      status: 'pending', // Yellow: in waiting for admin approval
      notes: notes || '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await set(newBookingRef, bookingData);

    // Celebration audio-visual effects
    soundFX.playWhistle();
    soundFX.playSuccess();

    // Close modal & notify
    document.getElementById('bookingModal').classList.remove('active');
    document.getElementById('bookingForm').reset();
    showToast('تم إرسال طلب الحجز بنجاح! في انتظار موافقة إدارة الملعب.', 'success');

  } catch (error) {
    console.error('Booking submission error:', error);
    showToast('حدث خطأ أثناء إرسال الحجز، يرجى المحاولة ثانيةً.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }
}

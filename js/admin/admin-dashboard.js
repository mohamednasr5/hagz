/**
 * admin-dashboard.js - Central Admin Management Engine
 * Coordinates tabs, authentication guard, real-time KPI aggregations,
 * booking approvals, edits, manual bookings, partial payments, and audit logs.
 */

import { 
  dbRefs, 
  onValue, 
  set, 
  update, 
  remove, 
  push, 
  get,
  runTransaction
} from '../firebase-config.js';
import { 
  isAdminAuthenticated, 
  loginAdmin, 
  logoutAdmin 
} from './auth.js';
import { 
  getEgyptNow, 
  formatEgyptDateKey, 
  formatCurrency, 
  formatArabicFullDate, 
  formatTime12H,
  formatSlotRange12H,
  calculateBookingPrice, 
  timeStringToMinutes,
  populateTimeSelect,
  findBookingConflict,
  describeBookingConflict,
  showToast 
} from '../utils.js';
import { calculateDailyFinances, renderDailyFinancialReport } from './finance.js';
import { initExpensesModule, getExpensesForDate } from './expenses.js';
import { loadMonthlyReports, exportAllReportsCSV } from './reports.js';
import { initSettingsModule } from './settings.js';

let selectedDateKey = formatEgyptDateKey(getEgyptNow());
let dayBookings = {};
let dayExpenses = {};
let activeDateListener = null;

document.addEventListener('DOMContentLoaded', () => {
  checkAuthentication();
});

function checkAuthentication() {
  const authOverlay = document.getElementById('authOverlay');
  const loginForm = document.getElementById('adminLoginForm');
  const errorMsg = document.getElementById('adminLoginError');

  if (!isAdminAuthenticated()) {
    if (authOverlay) authOverlay.style.display = 'flex';

    if (loginForm && !loginForm.dataset.bound) {
      loginForm.dataset.bound = 'true';
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pass = document.getElementById('adminPasswordInput').value;
        const res = await loginAdmin(pass);

        if (res.success) {
          if (authOverlay) authOverlay.style.display = 'none';
          initializeApp();
        } else {
          if (errorMsg) {
            errorMsg.textContent = res.message;
            errorMsg.style.display = 'block';
          }
        }
      });
    }
  } else {
    if (authOverlay) authOverlay.style.display = 'none';
    initializeApp();
  }
}

function initializeApp() {
  initNavigationTabs();
  initDateControls();
  initModals();
  loadDateData(selectedDateKey);
  initSettingsModule();

  const logoutBtn = document.getElementById('adminLogoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logoutAdmin);

  const exportBtn = document.getElementById('exportAllReportsBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportAllReportsCSV);
}

/**
 * Tab Navigation Switcher
 */
function initNavigationTabs() {
  const menuButtons = document.querySelectorAll('.menu-item[data-tab]');
  const tabSections = document.querySelectorAll('.admin-tab-section');

  menuButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      menuButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      tabSections.forEach(sec => {
        if (sec.id === `tab-${targetTab}`) {
          sec.classList.add('active');
        } else {
          sec.classList.remove('active');
        }
      });

      // Special tab triggers
      if (targetTab === 'reports') {
        loadMonthlyReports();
      }
    });
  });

  // Mobile sidebar toggle
  const toggleBtn = document.getElementById('toggleSidebarBtn');
  const sidebar = document.querySelector('.admin-sidebar');
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }
}

/**
 * Date selector controls for Admin
 */
function initDateControls() {
  const dateInput = document.getElementById('adminDateSelect');
  const displayLabel = document.getElementById('adminCurrentDateLabel');

  if (dateInput) {
    dateInput.value = selectedDateKey;
    dateInput.addEventListener('change', (e) => {
      if (e.target.value) {
        selectedDateKey = e.target.value;
        if (displayLabel) displayLabel.textContent = formatArabicFullDate(new Date(selectedDateKey));
        loadDateData(selectedDateKey);
      }
    });
  }

  if (displayLabel) {
    displayLabel.textContent = formatArabicFullDate(new Date(selectedDateKey));
  }
}


async function createLiveBooking(mode) {
  try {
    const minutes = Number(document.getElementById('liveBookingDuration')?.value);
    const customerName = document.getElementById('liveBookingCustomer')?.value.trim() || 'حجز مباشر';
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720) {
      showToast('أدخل مدة صحيحة من دقيقة إلى 720 دقيقة.', 'error');
      return;
    }

    const now = Date.now();
    const todayKey = formatEgyptDateKey(new Date(now));
    const todaySnapshot = await get(dbRefs.bookings(todayKey));
    const todayBookings = todaySnapshot.val() || {};
    let startTimestamp = now;

    if (mode === 'next') {
      const bookedUntil = Object.values(todayBookings)
        .filter(b => b && b.status !== 'cancelled' && b.status !== 'pending' && Number(b.endTimestamp) > now)
        .map(b => Number(b.endTimestamp));
      if (bookedUntil.length) startTimestamp = Math.max(now, ...bookedUntil);
    }

    const dateKey = formatEgyptDateKey(new Date(startTimestamp));
    const targetSnapshot = dateKey === todayKey ? todaySnapshot : await get(dbRefs.bookings(dateKey));
    const existing = targetSnapshot.val() || {};
    const cairoTime = (timestamp) => {
      const p = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: false
      }).formatToParts(new Date(timestamp)).reduce((a, x) => (a[x.type] = x.value, a), {});
      return p.hour + ':' + p.minute;
    };
    const startTime = cairoTime(startTimestamp);
    const endTimestamp = startTimestamp + minutes * 60000;
    const endTime = cairoTime(endTimestamp);
    const [sh, sm] = startTime.split(':').map(Number);
    const startMinute = sh * 60 + sm;
    const conflict = findBookingConflict(startMinute, startMinute + minutes, existing);
    if (conflict) {
      showToast(describeBookingConflict(conflict), 'error');
      return;
    }

    const settingsSnapshot = await get(dbRefs.settings());
    const pricing = calculateBookingPrice(startTime, minutes / 60, settingsSnapshot.val() || { dayPrice: 120, nightPrice: 180, dayStart: '06:00', nightStart: '18:00' });
    const newRef = push(dbRefs.bookings(dateKey));
    const bookingData = {
      bookingId: newRef.key,
      customerName,
      customerPhone: 'غير مسجل',
      phone: '',
      date: dateKey,
      startTime,
      endTime,
      durationMinutes: minutes,
      period: pricing.periodLabel,
      startTimestamp,
      endTimestamp,
      totalPrice: pricing.total,
      paidAmount: 0,
      remainingAmount: pricing.total,
      status: 'confirmed',
      notes: mode === 'now' ? 'حجز فوري من الإدارة' : 'الحجز التالي بعد الحجوزات القائمة',
      bookingType: mode === 'now' ? 'instant' : 'queued',
      createdAt: now,
      updatedAt: now,
      confirmedAt: now
    };
    let latestConflict = null;
    const transaction = await runTransaction(dbRefs.bookings(dateKey), current => {
      const latestBookings = current || {};
      latestConflict = findBookingConflict(startMinute, startMinute + minutes, latestBookings);
      if (latestConflict) return;
      latestBookings[newRef.key] = bookingData;
      return latestBookings;
    });
    if (!transaction.committed) {
      showToast(latestConflict ? describeBookingConflict(latestConflict) : 'لم يتم اعتماد الحجز. حاول مرة أخرى.', 'error');
      return;
    }

    document.getElementById('liveBookingModal')?.classList.remove('active');
    if (dateKey === selectedDateKey) updateDashboardUI();
    recordAuditLog(mode === 'now' ? 'حجز فوري' : 'الحجز التالي',
      customerName + ' • ' + startTime + ' إلى ' + endTime + ' • ' + minutes + ' دقيقة');
    showToast('تم تأكيد الحجز من ' + formatTime12H(startTime) + ' إلى ' + formatTime12H(endTime), 'success');
  } catch (error) {
    console.error('Live booking failed:', error);
    showToast('تعذر إنشاء الحجز. حاول مرة أخرى.', 'error');
  }
}

/**
 * Subscribes to Firebase for the selected date
 */
function loadDateData(dateKey) {
  if (activeDateListener) {
    activeDateListener();
    activeDateListener = null;
  }

  const dateRef = dbRefs.bookings(dateKey);
  activeDateListener = onValue(dateRef, (snapshot) => {
    dayBookings = snapshot.val() || {};
    updateDashboardUI();
  });

  // Load and listen to expenses for this date
  initExpensesModule(dateKey, (expenses) => {
    dayExpenses = expenses;
    updateDashboardUI();
  });
}

/**
 * Recomputes KPIs, updates tables and financial ledger
 */
function updateDashboardUI() {
  const now = Date.now();
  let totalBookings = 0;
  let bookedHours = 0;
  let pendingCount = 0;
  let activeCount = 0;
  let expiredCount = 0;

  for (const [id, b] of Object.entries(dayBookings)) {
    if (b.status === 'cancelled') continue;
    totalBookings++;

    const h = (Number(b.durationMinutes) || 60) / 60;
    bookedHours += h;

    if (b.status === 'pending') pendingCount++;
    if (b.status === 'confirmed') {
      if (now >= b.startTimestamp && now < b.endTimestamp) activeCount++;
      if (now >= b.endTimestamp) expiredCount++;
    }
  }

  const availableHours = Math.max(0, 16 - bookedHours);
  const finances = calculateDailyFinances(dayBookings, dayExpenses);

  // Update KPI Card UI elements
  setElText('kpiBookingsToday', totalBookings);
  setElText('kpiBookedHours', `${bookedHours.toFixed(1)} س`);
  setElText('kpiAvailableHours', `${availableHours.toFixed(1)} س`);
  setElText('kpiDailyRevenue', formatCurrency(finances.totalCashCollected));
  setElText('kpiDailyExpenses', formatCurrency(finances.totalExpenses));
  
  const netEl = document.getElementById('kpiDailyNet');
  if (netEl) {
    netEl.textContent = formatCurrency(finances.netDailyIncome);
    netEl.style.color = finances.netDailyIncome >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
  }

  setElText('kpiPendingCount', pendingCount);
  setElText('kpiActiveCount', activeCount);
  setElText('kpiExpiredCount', expiredCount);

  // Render Daily Financial Report
  renderDailyFinancialReport(selectedDateKey, finances);

  // Render Bookings Table
  renderBookingsTable();
  renderPendingApprovals();
}

/**
 * Renders Bookings Table with Action Buttons
 */
function renderBookingsTable() {
  const tbody = document.getElementById('allBookingsTableBody');
  if (!tbody) return;

  const entries = Object.entries(dayBookings);
  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #94a3b8; padding: 24px;">لا توجد حجوزات مسجلة لهذا التاريخ.</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map(([id, b]) => {
    const isPaid = (b.paidAmount || 0) >= (b.totalPrice || 0);
    const remaining = Math.max(0, (b.totalPrice || 0) - (b.paidAmount || 0));

    let statusBadge = '';
    if (b.status === 'pending') {
      statusBadge = '<span style="background: rgba(245,158,11,0.2); color: #fbbf24; padding: 4px 10px; border-radius: 20px; font-weight: 800;">في الانتظار</span>';
    } else if (b.status === 'confirmed') {
      statusBadge = '<span style="background: rgba(16,185,129,0.2); color: #34d399; padding: 4px 10px; border-radius: 20px; font-weight: 800;">مؤكد</span>';
    } else if (b.status === 'cancelled') {
      statusBadge = '<span style="background: rgba(239,68,68,0.2); color: #f87171; padding: 4px 10px; border-radius: 20px; font-weight: 800;">ملغي</span>';
    }

    return `
      <tr>
        <td style="font-weight: 800; color: #fff;">${escapeHtml(b.customerName)}</td>
        <td dir="ltr" style="text-align: right; color: #94a3b8;">${escapeHtml(b.customerPhone || '-')}</td>
        <td style="direction: rtl; font-weight: 700;">${formatSlotRange12H(b.startTime, b.endTime)}</td>
        <td>${(b.durationMinutes || 60) / 60} س</td>
        <td>${statusBadge}</td>
        <td style="font-weight: 800;">${formatCurrency(b.totalPrice)}</td>
        <td style="color: var(--accent-green); font-weight: 800;">${formatCurrency(b.paidAmount || 0)}</td>
        <td style="color: var(--accent-yellow); font-weight: 800;">${formatCurrency(remaining)}</td>
        <td>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            ${b.status === 'pending' ? `
              <button class="btn-action approve" onclick="window.handleApproveBooking('${b.bookingId}')">✓ تأكيد</button>
            ` : ''}
            <button class="btn-action pay" onclick="window.handleOpenPaymentModal('${b.bookingId}')">💰 دفعة</button>
            <button class="btn-action edit" onclick="window.handleOpenEditBooking('${b.bookingId}')">✏️ تعديل</button>
            <button class="btn-action cancel" onclick="window.handleCancelBooking('${b.bookingId}')">✕ إلغاء</button>
            <button class="btn-action cancel" style="background: rgba(239,68,68,0.35);" onclick="window.handleDeleteBooking('${b.bookingId}')">🗑️ حذف</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Renders Top Pending Requests Card
 */
function renderPendingApprovals() {
  const container = document.getElementById('pendingRequestsContainer');
  if (!container) return;

  const pendingList = Object.entries(dayBookings).filter(([_, b]) => b.status === 'pending');
  if (pendingList.length === 0) {
    container.innerHTML = `<div style="color: #94a3b8; text-align: center; padding: 16px;">لا توجد طلبات حجز معلقة تتطلب الموافقة حالياً</div>`;
    return;
  }

  container.innerHTML = pendingList.map(([id, b]) => `
    <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(245,158,11,0.3); border-radius: 12px; padding: 14px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <div style="font-weight: 800; font-size: 1.05rem; color: #fff;">👤 ${escapeHtml(b.customerName)}</div>
        <div style="font-size: 0.85rem; color: #94a3b8; direction: rtl;">
          ⏰ ${formatSlotRange12H(b.startTime, b.endTime)} • القيمة: ${formatCurrency(b.totalPrice)} • هاتف: ${escapeHtml(b.customerPhone)}
        </div>
        ${b.notes ? `<div style="font-size: 0.8rem; color: #fbbf24; margin-top: 4px;">📝 ${escapeHtml(b.notes)}</div>` : ''}
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="btn-action approve" onclick="window.handleApproveBooking('${b.bookingId}')">✓ موافقة وتأكيد</button>
        <button class="btn-action cancel" onclick="window.handleCancelBooking('${b.bookingId}')">رفض</button>
      </div>
    </div>
  `).join('');
}

/**
 * Handles Modals (Manual Booking, Edit Booking, Partial Payment)
 */
function initModals() {
  const liveModal = document.getElementById('liveBookingModal');
  const liveForm = document.getElementById('liveBookingForm');
  const modeInput = document.getElementById('liveBookingMode');
  const openNow = document.getElementById('btnBookFromNow');
  const openNext = document.getElementById('btnBookNext');
  const closeLive = document.getElementById('closeLiveBookingModal');
  const cancelLive = document.getElementById('cancelLiveBookingModal');

  if (openNow && liveModal) openNow.addEventListener('click', () => {
    modeInput.value = 'now';
    document.getElementById('liveBookingTitle').textContent = 'حجز الملعب من الآن';
    document.getElementById('liveBookingStartHint').textContent = 'سيبدأ الحجز فور التأكيد حسب توقيت القاهرة الحالي.';
    liveModal.classList.add('active');
  });
  if (openNext && liveModal) openNext.addEventListener('click', () => {
    modeInput.value = 'next';
    document.getElementById('liveBookingTitle').textContent = 'تسجيل الحجز التالي';
    document.getElementById('liveBookingStartHint').textContent = 'سيبدأ بعد انتهاء آخر حجز مؤكد قائم أو قادم.';
    liveModal.classList.add('active');
  });
  [closeLive, cancelLive].forEach(button => {
    if (button) button.addEventListener('click', () => liveModal?.classList.remove('active'));
  });
  if (liveForm) liveForm.addEventListener('submit', async event => {
    event.preventDefault();
    await createLiveBooking(modeInput.value);
  });

  // Manual Booking Modal
  const btnNewBooking = document.getElementById('btnOpenManualBookingModal');
  const manualModal = document.getElementById('manualBookingModal');
  const closeManualBtn = document.getElementById('closeManualBookingModal');
  const manualForm = document.getElementById('manualBookingForm');
  const manualStartInput = document.getElementById('manualStartTime');
  populateTimeSelect(manualStartInput, '09:00');

  if (btnNewBooking && manualModal) {
    btnNewBooking.addEventListener('click', () => {
      document.getElementById('manualBookingDate').value = selectedDateKey;
      manualModal.classList.add('active');
    });
  }

  if (closeManualBtn && manualModal) {
    closeManualBtn.addEventListener('click', () => manualModal.classList.remove('active'));
  }

  if (manualForm) {
    manualForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const name = document.getElementById('manualCustomerName').value.trim();
        const phone = document.getElementById('manualCustomerPhone').value.trim();
        const startTime = document.getElementById('manualStartTime').value;
        const duration = Number(document.getElementById('manualDuration').value) || 1;
        const customPrice = Number(document.getElementById('manualCustomPrice').value);
        const paidAmount = Number(document.getElementById('manualPaidAmount').value) || 0;
        const notes = document.getElementById('manualNotes').value.trim();

        const [sh, sm] = startTime.split(':').map(Number);
        const startMin = sh * 60 + sm;
        const durationMinutes = Math.round(duration * 60);
        if (!name || !Number.isFinite(durationMinutes) || durationMinutes < 30 || durationMinutes % 30 !== 0) {
          showToast('أدخل اسم العميل ومدة صحيحة بمضاعفات 30 دقيقة.', 'error');
          return;
        }
        const endMin = startMin + durationMinutes;
        const conflict = findBookingConflict(startMin, endMin, dayBookings);
        if (conflict) {
          showToast(describeBookingConflict(conflict), 'error');
          return;
        }

        const endH = Math.floor(endMin / 60) % 24;
        const endM = endMin % 60;
        const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

        const [y, m, d] = selectedDateKey.split('-').map(Number);
        const startTimestamp = new Date(y, m - 1, d, sh, sm, 0).getTime();
        const endTimestamp = startTimestamp + (durationMinutes * 60 * 1000);

        const newRef = push(dbRefs.bookings(selectedDateKey));
        await set(newRef, {
          bookingId: newRef.key,
          customerName: name,
          customerPhone: phone || 'غير مسجل',
          date: selectedDateKey,
          startTime,
          endTime,
          durationMinutes,
          period: 'حجز يدوي بواسطة الإدارة',
          startTimestamp,
          endTimestamp,
          totalPrice: customPrice || 150,
          paidAmount,
          remainingAmount: Math.max(0, (customPrice || 150) - paidAmount),
          status: 'confirmed', // Admin confirmed
          notes,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });

        recordAuditLog('إنشاء حجز يدوي', `قام المسؤول بإنشاء حجز للعميل ${name} بمبلغ ${customPrice} ج.م`);
        manualModal.classList.remove('active');
        manualForm.reset();
        showToast('تم إنشاء الحجز بنجاح!', 'success');
      } catch (err) {
        console.error('Error creating manual booking:', err);
        showToast('فشل إنشاء الحجز', 'error');
      }
    });
  }

  // Payment Modal
  const payModal = document.getElementById('paymentModal');
  const payForm = document.getElementById('paymentForm');
  const closePayBtn = document.getElementById('closePaymentModal');

  if (closePayBtn && payModal) {
    closePayBtn.addEventListener('click', () => payModal.classList.remove('active'));
  }

  if (payForm) {
    payForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const bookingId = document.getElementById('paymentBookingId').value;
      const additionalPaid = Number(document.getElementById('paymentAddAmount').value) || 0;

      if (!bookingId || additionalPaid <= 0) {
        showToast('يرجى إدخال مبلغ دفع صالح', 'error');
        return;
      }

      try {
        const booking = dayBookings[bookingId];
        if (!booking) return;

        const currentPaid = Number(booking.paidAmount) || 0;
        const newPaid = currentPaid + additionalPaid;
        const totalPrice = Number(booking.totalPrice) || 0;
        const newRemaining = Math.max(0, totalPrice - newPaid);

        await update(dbRefs.bookingItem(selectedDateKey, bookingId), {
          paidAmount: newPaid,
          remainingAmount: newRemaining,
          updatedAt: Date.now()
        });

        recordAuditLog('تسجيل دفعة نقدية', `تم تحصيل دفعة بقيمة ${additionalPaid} ج.م للعميل ${booking.customerName}`);
        payModal.classList.remove('active');
        payForm.reset();
        showToast('تم تسجيل الدفعة النقدية بنجاح!', 'success');
      } catch (err) {
        console.error('Error recording payment:', err);
        showToast('فشل تسجيل الدفعة', 'error');
      }
    });
  }
}

// Global actions exposed for buttons
window.handleApproveBooking = async function(bookingId) {
  try {
    const booking = dayBookings[bookingId];
    if (!booking) return;

    await update(dbRefs.bookingItem(selectedDateKey, bookingId), {
      status: 'confirmed',
      approvedAt: Date.now(),
      confirmedAt: Date.now(),
      updatedAt: Date.now()
    });

    recordAuditLog('تأكيد حجز', `تمت الموافقة على حجز ${booking.customerName} الساعة ${booking.startTime}`);
    showToast(`تم تأكيد حجز ${booking.customerName} وتحويله إلى اللون الأحمر بنجاح!`, 'success');
  } catch (err) {
    console.error('Error approving booking:', err);
    showToast('فشل تأكيد الحجز', 'error');
  }
};

window.handleCancelBooking = async function(bookingId) {
  if (!confirm('هل أنت متأكد من إلغاء هذا الحجز؟')) return;

  try {
    const booking = dayBookings[bookingId];
    await update(dbRefs.bookingItem(selectedDateKey, bookingId), {
      status: 'cancelled',
      updatedAt: Date.now()
    });

    recordAuditLog('إلغاء حجز', `تم إلغاء حجز ${booking ? booking.customerName : bookingId}`);
    showToast('تم إلغاء الحجز وإتاحة الموعد للآخرين.', 'success');
  } catch (err) {
    console.error('Error cancelling booking:', err);
    showToast('فشل إلغاء الحجز', 'error');
  }
};

window.handleDeleteBooking = async function(bookingId) {
  if (!confirm('تحذير: سيتم حذف الحجز نهائياً من قاعدة البيانات. هل تريد الاستمرار؟')) return;

  try {
    await remove(dbRefs.bookingItem(selectedDateKey, bookingId));
    recordAuditLog('حذف حجز نهائي', `تم حذف الحجز ${bookingId} نهائياً`);
    showToast('تم حذف الحجز نهائياً بنجاح', 'success');
  } catch (err) {
    console.error('Error deleting booking:', err);
    showToast('فشل حذف الحجز', 'error');
  }
};

window.handleOpenPaymentModal = function(bookingId) {
  const booking = dayBookings[bookingId];
  if (!booking) return;

  document.getElementById('paymentBookingId').value = bookingId;
  document.getElementById('paymentCustomerName').textContent = booking.customerName;
  document.getElementById('paymentTotalAmount').textContent = formatCurrency(booking.totalPrice);
  document.getElementById('paymentCurrentPaid').textContent = formatCurrency(booking.paidAmount || 0);
  document.getElementById('paymentRemaining').textContent = formatCurrency(booking.remainingAmount || 0);
  document.getElementById('paymentAddAmount').value = booking.remainingAmount || 0;

  document.getElementById('paymentModal').classList.add('active');
};

window.handleOpenEditBooking = function(bookingId) {
  const booking = dayBookings[bookingId];
  if (!booking) return;

  const newName = prompt('تعديل اسم العميل:', booking.customerName);
  if (newName === null) return;

  const newPrice = prompt('تعديل القيمة الإجمالية (ج.م):', booking.totalPrice);
  if (newPrice === null) return;

  update(dbRefs.bookingItem(selectedDateKey, bookingId), {
    customerName: newName.trim() || booking.customerName,
    totalPrice: Number(newPrice) || booking.totalPrice,
    remainingAmount: Math.max(0, (Number(newPrice) || booking.totalPrice) - (booking.paidAmount || 0)),
    updatedAt: Date.now()
  }).then(() => {
    recordAuditLog('تعديل حجز', `تم تعديل بيانات الحجز ${booking.customerName}`);
    showToast('تم تحديث بيانات الحجز بنجاح', 'success');
  });
};

function recordAuditLog(action, detail) {
  try {
    const logRef = push(dbRefs.auditLogs());
    set(logRef, {
      logId: logRef.key,
      action,
      detail,
      timestamp: Date.now()
    });
  } catch (e) {}
}

function setElText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
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

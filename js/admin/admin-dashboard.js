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
 * Tab Navigation Switcher & Mobile Drawer Controls
 */
function initNavigationTabs() {
  const sidebar = document.getElementById('adminSidebar') || document.querySelector('.admin-sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  const toggleBtn = document.getElementById('toggleSidebarBtn');
  const closeBtn = document.getElementById('closeSidebarBtn');
  const mobileNavMenuTrigger = document.getElementById('mobileNavMenuTrigger');

  const tabSections = document.querySelectorAll('.admin-tab-section');

  function switchTab(targetTab) {
    if (!targetTab) return;

    // Update desktop sidebar buttons
    document.querySelectorAll('.menu-item[data-tab]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === targetTab);
    });

    // Update mobile bottom nav items
    document.querySelectorAll('.admin-mobile-nav-item[data-tab]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === targetTab);
    });

    // Toggle active sections
    tabSections.forEach(sec => {
      sec.classList.toggle('active', sec.id === `tab-${targetTab}`);
    });

    // Close mobile drawer if open
    closeSidebarDrawer();

    // Trigger specific tab logic
    if (targetTab === 'reports') {
      loadMonthlyReports();
    }

    // Scroll smoothly to top of main content
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Bind all tab buttons (Sidebar & Bottom Nav)
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetTab = btn.getAttribute('data-tab');
      if (targetTab) switchTab(targetTab);
    });
  });

  function openSidebarDrawer() {
    if (sidebar) sidebar.classList.add('open');
    if (backdrop) backdrop.classList.add('active');
    document.body.classList.add('sidebar-open');
  }

  function closeSidebarDrawer() {
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('active');
    document.body.classList.remove('sidebar-open');
  }

  // Toggle & Close listeners
  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (sidebar?.classList.contains('open')) {
        closeSidebarDrawer();
      } else {
        openSidebarDrawer();
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closeSidebarDrawer);
  }

  if (backdrop) {
    backdrop.addEventListener('click', closeSidebarDrawer);
  }

  if (mobileNavMenuTrigger) {
    mobileNavMenuTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      openSidebarDrawer();
    });
  }

  // Close sidebar when clicking links inside sidebar footer
  document.querySelectorAll('.sidebar-footer .menu-item').forEach(link => {
    link.addEventListener('click', closeSidebarDrawer);
  });
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
  setElText('kpiDailyRevenue', formatCurrency(finances.totalBookingRevenue + finances.totalOtherIncome));
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
        <td data-label="العميل / الفريق" class="td-customer" style="font-weight: 800; color: #fff;">${escapeHtml(b.customerName)}</td>
        <td data-label="الهاتف" class="td-phone" dir="ltr" style="text-align: right; color: #94a3b8;">${escapeHtml(b.customerPhone || '-')}</td>
        <td data-label="الموعد" class="td-time" style="direction: rtl; font-weight: 700;">${formatSlotRange12H(b.startTime, b.endTime)}</td>
        <td data-label="المدة" class="td-duration">${Number(b.durationMinutes || 60)} دقيقة</td>
        <td data-label="الحالة" class="td-status">${statusBadge}</td>
        <td data-label="القيمة الإجمالية" class="td-price" style="font-weight: 800;">${formatCurrency(b.totalPrice)}</td>
        <td data-label="المدفوع" class="td-paid" style="color: var(--accent-green); font-weight: 800;">${formatCurrency(b.paidAmount || 0)}</td>
        <td data-label="المتبقي" class="td-remaining" style="color: var(--accent-yellow); font-weight: 800;">${formatCurrency(remaining)}</td>
        <td data-label="الإجراءات" class="td-actions">
          <div class="table-actions-cluster">
            ${b.status === 'pending' ? `
              <button class="btn-action approve" onclick="window.handleApproveBooking('${b.bookingId}')">✓ تأكيد</button>
            ` : ''}
            <button class="btn-action pay" onclick="window.handleOpenPaymentModal('${b.bookingId}')">💰 دفعة</button>
            <button class="btn-action edit" onclick="window.handleOpenEditBooking('${b.bookingId}')">✏️ تعديل</button>
            <button class="btn-action cancel" onclick="window.handleCancelBooking('${b.bookingId}')">✕ إلغاء</button>
            <button class="btn-action delete" onclick="window.handleDeleteBooking('${b.bookingId}')">🗑️ حذف</button>
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
    <div class="pending-request-card">
      <div class="pending-card-info">
        <div class="pending-card-name">👤 ${escapeHtml(b.customerName)}</div>
        <div class="pending-card-meta">
          ⏰ ${formatSlotRange12H(b.startTime, b.endTime)} • القيمة: ${formatCurrency(b.totalPrice)} • هاتف: ${escapeHtml(b.customerPhone || '-')}
        </div>
        ${b.notes ? `<div class="pending-card-notes">📝 ${escapeHtml(b.notes)}</div>` : ''}
      </div>
      <div class="pending-card-actions">
        <button class="btn-action approve" onclick="window.handleApproveBooking('${b.bookingId}')">✓ موافقة وتأكيد</button>
        <button class="btn-action cancel" onclick="window.handleCancelBooking('${b.bookingId}')">رفض الحجز</button>
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
  const manualStartTime = document.getElementById('manualStartTime');
  if (manualStartTime) manualStartTime.addEventListener('change', () => {
    const [hour, minute] = manualStartTime.value.split(':').map(Number);
    const now = new Date();
    const cairoParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now).reduce((obj, part) => (obj[part.type] = part.value, obj), {});
    const selectedDay = document.getElementById('manualBookingDate')?.value || selectedDateKey;
    if (selectedDay !== cairoParts.year + '-' + cairoParts.month + '-' + cairoParts.day) return;
    const selectedStart = cairoDateTimeToTimestamp(Number(cairoParts.year), Number(cairoParts.month), Number(cairoParts.day), manualStartTime.value);
    if (selectedStart >= now.getTime()) return;
    // Admin can register bookings in elapsed time; never block solely due to the clock.
  });


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
        const durationMinutes = Number(document.getElementById('manualDuration').value);
        const customPrice = Number(document.getElementById('manualCustomPrice').value);
        const paidAmount = Number(document.getElementById('manualPaidAmount').value) || 0;
        const notes = document.getElementById('manualNotes').value.trim();

        const [sh, sm] = startTime.split(':').map(Number);
        const startMin = sh * 60 + sm;
        if (!name || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 720) {
          showToast('أدخل اسم العميل ومدة صحيحة بالدقائق من 1 إلى 720.', 'error');
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
        const startTimestamp = cairoDateTimeToTimestamp(y, m, d, startTime);
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

        recordAuditLog('إنشاء حجز يدوي', `قام المسؤول بإنشاء حجز للعميل ${name} بمبلغ ${customPrice} ج.م لمدة ${durationMinutes} دقيقة`);
        manualModal.classList.remove('active');
        manualForm.reset();
        showToast('تم إنشاء الحجز بنجاح!', 'success');
      } catch (err) {
        console.error('Error creating manual booking:', err);
        showToast('فشل إنشاء الحجز', 'error');
      }
    });
  }

  const editForm = document.getElementById('editBookingForm');
  const editClose = document.getElementById('closeEditBookingModal');
  if (editForm && !editForm.dataset.bound) {
    editForm.dataset.bound = 'true';
    editForm.addEventListener('submit', saveBookingEdit);
  }
  if (editClose) editClose.addEventListener('click', () => document.getElementById('editBookingModal')?.classList.remove('active'));

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
  const modal = document.getElementById('editBookingModal');
  if (!modal) return;
  document.getElementById('editBookingId').value = bookingId;
  document.getElementById('editCustomerName').value = booking.customerName || '';
  document.getElementById('editCustomerPhone').value = booking.customerPhone || '';
  document.getElementById('editStartTime').value = booking.startTime || '09:00';
  document.getElementById('editDuration').value = Number(booking.durationMinutes) || 60;
  document.getElementById('editTotalPrice').value = Number(booking.totalPrice) || 0;
  document.getElementById('editPaidAmount').value = Number(booking.paidAmount) || 0;
  document.getElementById('editNotes').value = booking.notes || '';
  modal.classList.add('active');
};

async function saveBookingEdit(event) {
  event.preventDefault();
  const bookingId = document.getElementById('editBookingId').value;
  const booking = dayBookings[bookingId];
  if (!booking) return;
  const customerName = document.getElementById('editCustomerName').value.trim();
  const customerPhone = document.getElementById('editCustomerPhone').value.trim();
  const startTime = document.getElementById('editStartTime').value;
  const durationMinutes = Number(document.getElementById('editDuration').value);
  const totalPrice = Number(document.getElementById('editTotalPrice').value);
  const paidAmount = Number(document.getElementById('editPaidAmount').value) || 0;
  const notes = document.getElementById('editNotes').value.trim();
  if (!customerName || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(startTime) || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 720 || !Number.isFinite(totalPrice) || totalPrice < 0 || !Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > totalPrice) {
    showToast('راجع الاسم والوقت والمدة بالدقائق والمبالغ المدخلة.', 'error');
    return;
  }
  const startMinutes = timeStringToMinutes(startTime);
  const endMinutes = startMinutes + durationMinutes;
  const conflict = findBookingConflict(startMinutes, endMinutes, dayBookings, bookingId);
  if (conflict) { showToast(describeBookingConflict(conflict), 'error'); return; }
  const parts = selectedDateKey.split('-').map(Number);
  const startTimestamp = cairoDateTimeToTimestamp(parts[0], parts[1], parts[2], startTime);
  const endTimestamp = startTimestamp + durationMinutes * 60000;
  const endTime = String(Math.floor(endMinutes / 60) % 24).padStart(2,'0') + ':' + String(endMinutes % 60).padStart(2,'0');
  try {
    await update(dbRefs.bookingItem(selectedDateKey, bookingId), {
      customerName, customerPhone: customerPhone || 'غير مسجل', phone: customerPhone,
      startTime, endTime, durationMinutes, startTimestamp, endTimestamp,
      totalPrice, paidAmount, remainingAmount: Math.max(0, totalPrice - paidAmount), notes, updatedAt: Date.now()
    });
    recordAuditLog('تعديل كامل للحجز', 'تم تعديل حجز ' + booking.customerName + ' إلى ' + customerName + ' • ' + durationMinutes + ' دقيقة • ' + totalPrice + ' ج.م');
    document.getElementById('editBookingModal').classList.remove('active');
    showToast('تم تحديث جميع بيانات الحجز بنجاح', 'success');
  } catch (error) {
    console.error('Booking edit failed:', error);
    showToast('تعذر حفظ تعديل الحجز', 'error');
  }
}
function cairoDateTimeToTimestamp(year, month, day, time) {
  const timeParts = time.split(':').map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, timeParts[0], timeParts[1]);
  const offsetName = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', timeZoneName: 'longOffset' }).formatToParts(new Date(utcGuess)).find(p => p.type === 'timeZoneName')?.value || 'GMT+02:00';
  const match = offsetName.match(/GMT([+-])(\\d{2}):(\\d{2})/);
  if (!match) return utcGuess - 7200000;
  const offsetMinutes = (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
  return utcGuess - offsetMinutes * 60000;
}

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

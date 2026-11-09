/**
 * app.js - Main Client Application Logic
 * Initializes clock, date navigator, PWA registration, bottom navigation, and settings synchronization.
 */

import { dbRefs, onValue } from './firebase-config.js';
import { 
  getEgyptNow, 
  formatEgyptDateKey, 
  getArabicDayName, 
  formatArabicFullDate, 
  formatCurrency, 
  showToast 
} from './utils.js';
import { setPitchSettings, initBookingModal } from './booking.js';
import { loadScheduleForDate } from './schedule.js';
import { soundFX } from './audio-fx.js';

let currentDate = getEgyptNow();
let deferredPrompt = null;

document.addEventListener('DOMContentLoaded', () => {
  initLiveClock();
  initDateNavigator();
  initSettingsListener();
  initBookingModal();
  initBottomNav();
  initPwaAndServiceWorker();
  initNetworkListeners();

  // Load today's schedule initially
  const initialDateKey = formatEgyptDateKey(currentDate);
  loadScheduleForDate(initialDateKey);
});

/**
 * Switch view between Tactical Pitch Formation and Cards List
 */
window.switchScheduleView = function(view) {
  soundFX.playClick();
  const pitchContainer = document.getElementById('pitchFormationContainer');
  const cardsContainer = document.getElementById('slotsContainer');
  const pitchBtn = document.getElementById('viewTogglePitchBtn');
  const cardsBtn = document.getElementById('viewToggleCardsBtn');

  if (view === 'pitch') {
    if (pitchContainer) pitchContainer.style.display = 'block';
    if (cardsContainer) cardsContainer.style.display = 'none';
    if (pitchBtn) pitchBtn.classList.add('active');
    if (cardsBtn) cardsBtn.classList.remove('active');
  } else {
    if (pitchContainer) pitchContainer.style.display = 'none';
    if (cardsContainer) cardsContainer.style.display = 'grid';
    if (cardsBtn) cardsBtn.classList.add('active');
    if (pitchBtn) pitchBtn.classList.remove('active');
  }
};

/**
 * Live Egypt Digital Clock
 */
function initLiveClock() {
  const clockEl = document.getElementById('liveEgyptClock');
  const updateClock = () => {
    if (!clockEl) return;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit',
      second: '2-digit', hour12: false
    }).formatToParts(new Date()).reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
    const rawHour = Number(parts.hour);
    const period = rawHour >= 12 ? 'م' : 'ص';
    const hours = String(rawHour % 12 || 12).padStart(2, '0');
    const minutes = parts.minute;
    const seconds = parts.second;
    clockEl.textContent = `${hours}:${minutes}:${seconds} ${period}`;
  };

  updateClock();
  setInterval(updateClock, 1000);
}

/**
 * Date Navigator (Previous, Next, Today, Date Picker)
 */
function initDateNavigator() {
  const prevBtn = document.getElementById('prevDateBtn');
  const nextBtn = document.getElementById('nextDateBtn');
  const todayBtn = document.getElementById('todayDateBtn');
  const dateInput = document.getElementById('datePickerInput');
  const dateDisplay = document.getElementById('dateDisplayArea');

  const updateDateUI = () => {
    const dayNameEl = document.getElementById('dateDayName');
    const formattedEl = document.getElementById('dateFormatted');
    const dateKey = formatEgyptDateKey(currentDate);

    if (dayNameEl) dayNameEl.textContent = getArabicDayName(currentDate);
    if (formattedEl) formattedEl.textContent = formatArabicFullDate(currentDate);
    if (dateInput) dateInput.value = dateKey;

    loadScheduleForDate(dateKey);
  };

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      soundFX.playClick();
      currentDate.setDate(currentDate.getDate() - 1);
      updateDateUI();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      soundFX.playClick();
      currentDate.setDate(currentDate.getDate() + 1);
      updateDateUI();
    });
  }

  if (todayBtn) {
    todayBtn.addEventListener('click', () => {
      soundFX.playClick();
      currentDate = getEgyptNow();
      updateDateUI();
    });
  }

  if (dateDisplay && dateInput) {
    dateDisplay.addEventListener('click', () => {
      try {
        dateInput.showPicker();
      } catch (e) {
        dateInput.focus();
      }
    });

    dateInput.addEventListener('change', (e) => {
      if (e.target.value) {
        const [y, m, d] = e.target.value.split('-').map(Number);
        currentDate = new Date(y, m - 1, d);
        updateDateUI();
      }
    });
  }

  updateDateUI();
}

/**
 * Settings listener from Firebase Realtime Database
 */
function initSettingsListener() {
  const settingsRef = dbRefs.settings();
  onValue(settingsRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      setPitchSettings(data);

      const pitchNameEl = document.getElementById('pitchNameTitle');
      const dayRateEl = document.getElementById('heroDayRate');
      const nightRateEl = document.getElementById('heroNightRate');

      if (pitchNameEl && data.pitchName) pitchNameEl.textContent = data.pitchName;
      if (dayRateEl && data.dayPrice) dayRateEl.textContent = formatCurrency(data.dayPrice);
      if (nightRateEl && data.nightPrice) nightRateEl.textContent = formatCurrency(data.nightPrice);
    }
  });
}

/**
 * Mobile Bottom Navigation active states & scrolling
 */
function initBottomNav() {
  const navItems = document.querySelectorAll('.bottom-nav-item');
  navItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      const target = item.getAttribute('data-target');
      if (target && target.startsWith('#')) {
        e.preventDefault();
        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');

        const section = document.querySelector(target);
        if (section) {
          section.scrollIntoView({ behavior: 'smooth' });
        }
      }
    });
  });
}

/**
 * PWA Service Worker Registration & Installation Prompt
 */
function initPwaAndServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => {
          console.log('Ahmadiah Pitch Service Worker registered with scope:', reg.scope);
        })
        .catch((err) => {
          console.warn('Service Worker registration error:', err);
        });
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBanner = document.getElementById('pwaInstallPrompt');
    if (installBanner) installBanner.style.display = 'flex';
  });

  const installBtn = document.getElementById('btnInstallApp');
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          showToast('شكراً لتثبيت تطبيق ملعب الأحمدية!', 'success');
        }
        deferredPrompt = null;
        const banner = document.getElementById('pwaInstallPrompt');
        if (banner) banner.style.display = 'none';
      }
    });
  }
}

/**
 * Online / Offline Status Detection
 */
function initNetworkListeners() {
  const banner = document.getElementById('offlineBanner');
  const updateStatus = () => {
    if (!navigator.onLine) {
      if (banner) banner.classList.add('active');
      showToast('أنت غير متصل بالإنترنت حالياً. تم تعطيل الحجز حتى عودة الاتصال.', 'error');
    } else {
      if (banner) banner.classList.remove('active');
    }
  };

  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
  updateStatus();
}

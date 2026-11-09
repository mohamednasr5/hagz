/**
 * display.js - Stadium Live Display Logic
 * Real-time clock, match spotlight, massive countdown, next match tracking.
 */

import { dbRefs, onValue } from './firebase-config.js';
import { 
  getEgyptNow, 
  formatEgyptDateKey, 
  getArabicDayName, 
  formatArabicFullDate, 
  formatTime12H,
  formatSlotRange12H,
  timeStringToMinutes 
} from './utils.js';
import { countdownEngine } from './countdown.js';

let todaysBookings = {};
let activeBookingId = null;

document.addEventListener('DOMContentLoaded', () => {
  initClock();
  initSettings();
  initScheduleListener();
});

function initClock() {
  const clockEl = document.getElementById('tvDigitalClock');
  const dateEl = document.getElementById('tvDateDisplay');

  const update = () => {
    const now = getEgyptNow();
    let rawH = now.getHours();
    const period = rawH >= 12 ? 'م' : 'ص';
    let h12 = rawH % 12;
    if (h12 === 0) h12 = 12;

    const h = String(h12).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');

    if (clockEl) clockEl.textContent = `${h}:${m}:${s} ${period}`;
    if (dateEl) dateEl.textContent = `${getArabicDayName(now)} - ${formatArabicFullDate(now)}`;
  };

  update();
  setInterval(update, 1000);
}

function initSettings() {
  onValue(dbRefs.settings(), (snap) => {
    const val = snap.val();
    if (val && val.pitchName) {
      const el = document.getElementById('tvPitchName');
      if (el) el.textContent = val.pitchName;
    }
  });
}

function initScheduleListener() {
  const todayKey = formatEgyptDateKey(getEgyptNow());
  const todayRef = dbRefs.bookings(todayKey);

  onValue(todayRef, (snapshot) => {
    todaysBookings = snapshot.val() || {};
    updateLiveDisplay();
  });

  // Re-check periodically every 15 seconds in case time crossed slot boundaries
  setInterval(updateLiveDisplay, 15000);
}

function updateLiveDisplay() {
  const now = Date.now();
  let currentOngoing = null;
  let currentOngoingId = null;
  let nextMatch = null;
  let nextMatchDiff = Infinity;

  const sortedBookings = Object.entries(todaysBookings)
    .filter(([_, b]) => b.status === 'confirmed')
    .sort((a, b) => a[1].startTimestamp - b[1].startTimestamp);

  for (const [id, b] of sortedBookings) {
    if (now >= b.startTimestamp && now < b.endTimestamp) {
      currentOngoing = b;
      currentOngoingId = id;
    } else if (b.startTimestamp > now) {
      const diff = b.startTimestamp - now;
      if (diff < nextMatchDiff) {
        nextMatchDiff = diff;
        nextMatch = b;
      }
    }
  }

  const spotlight = document.getElementById('tvSpotlight');
  const badge = document.getElementById('tvLiveBadge');
  const title = document.getElementById('tvMatchTitle');
  const period = document.getElementById('tvMatchPeriod');
  const hugeCountdown = document.getElementById('tvHugeCountdown');
  const progressBar = document.getElementById('tvProgressBar');
  const startEnd = document.getElementById('tvMatchStartEnd');
  const lighting = document.getElementById('tvLightingStatus');

  if (currentOngoing) {
    spotlight.classList.remove('idle-state');
    badge.style.background = '#ef4444';
    badge.style.boxShadow = '0 0 20px rgba(239, 68, 68, 0.8)';
    badge.innerHTML = '<span>🔴 مباراة جارية الآن</span>';

    title.textContent = currentOngoing.customerName || 'مباراة مباشرة';
    period.textContent = `الفترة: ${currentOngoing.period || 'ملعب خماسي'} • كشافات الملعب مفعلة`;
    startEnd.textContent = `المباراة: ${formatSlotRange12H(currentOngoing.startTime, currentOngoing.endTime)}`;

    const isNight = (currentOngoing.period || '').includes('ليل');
    lighting.textContent = isNight ? '💡 كشافات الملعب: تشغيل كامل' : '☀️ إضاءة طبيعية: نهارية';

    // Register with countdown engine
    if (activeBookingId !== currentOngoingId) {
      activeBookingId = currentOngoingId;
      countdownEngine.register(
        currentOngoingId,
        currentOngoing.startTimestamp,
        currentOngoing.endTimestamp,
        (data) => {
          if (data.isExpired) {
            hugeCountdown.textContent = '00:00';
            hugeCountdown.style.color = '#f97316';
            badge.innerHTML = '<span>🟠 انتهى وقت الحجز</span>';
            title.textContent = 'انتهى وقت المباراة';
            period.textContent = 'الملعب جاهز للمباراة القادمة، يرجى إخلاء أرضية الملعب';
            if (progressBar) progressBar.style.width = '100%';
          } else {
            hugeCountdown.textContent = `${data.minutes}:${data.seconds}`;
            hugeCountdown.style.color = '#ff4d4d';
            if (progressBar) progressBar.style.width = `${data.progress}%`;
          }
        },
        () => {
          updateLiveDisplay();
        }
      );
    }

  } else {
    // Idle State
    activeBookingId = null;
    spotlight.classList.add('idle-state');
    badge.style.background = '#10b981';
    badge.style.boxShadow = '0 0 20px rgba(16, 185, 129, 0.6)';
    badge.innerHTML = '<span>🟢 الملعب متاح وجاهز</span>';

    title.textContent = 'لا توجد مباراة جارية حالياً';
    period.textContent = 'الملعب متاح وجاهز لاستقبال الحجز التالي';
    hugeCountdown.textContent = '--:--';
    hugeCountdown.style.color = '#10b981';
    if (progressBar) progressBar.style.width = '0%';
    startEnd.textContent = 'الملعب في حالة جاهزية';
    lighting.textContent = '💡 نظام الإنارة: في وضع الاستعداد';
  }

  // Update Next Match Box
  const nextMatchEl = document.getElementById('tvNextMatchArea');
  if (nextMatchEl) {
    if (nextMatch) {
      const minutesUntil = Math.round((nextMatch.startTimestamp - now) / 60000);
      nextMatchEl.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong style="color: #38bdf8; font-size: 1.25rem;">${escapeHtml(nextMatch.customerName)}</strong>
          <span style="background: rgba(56, 189, 248, 0.2); padding: 4px 12px; border-radius: 20px; font-weight: 800; font-size: 0.9rem; direction: rtl;">
            ${formatTime12H(nextMatch.startTime)}
          </span>
        </div>
        <div style="color: #94a3b8; font-size: 0.95rem;">
          تبدأ خلال ${minutesUntil} دقيقة تقريباً • المدة: ${(nextMatch.durationMinutes || 60) / 60} ساعة
        </div>
      `;
    } else {
      nextMatchEl.innerHTML = `
        <div style="color: #10b981; font-weight: 700;">لا توجد حجوزات أخرى متبقية لليوم</div>
      `;
    }
  }

  // Update Remaining Matches List
  const listEl = document.getElementById('tvUpcomingList');
  if (listEl) {
    if (sortedBookings.length === 0) {
      listEl.innerHTML = '<div style="color: #94a3b8; text-align: center; padding: 20px;">لم يتم تسجيل حجوزات اليوم حتى الآن</div>';
    } else {
      listEl.innerHTML = sortedBookings.map(([_, b]) => {
        const isCurrent = currentOngoing && currentOngoing.bookingId === b.bookingId;
        const isPast = now >= b.endTimestamp;
        let statusTag = '';
        if (isCurrent) {
          statusTag = '<span style="background: rgba(239, 68, 68, 0.2); color: #ef4444; padding: 2px 8px; border-radius: 12px; font-weight: 800;">جاري</span>';
        } else if (isPast) {
          statusTag = '<span style="color: #94a3b8; font-size: 0.85rem;">انتهت</span>';
        } else {
          statusTag = '<span style="background: rgba(16, 185, 129, 0.2); color: #10b981; padding: 2px 8px; border-radius: 12px; font-weight: 800;">قادمة</span>';
        }

        return `
          <div class="tv-upcoming-item" style="${isCurrent ? 'border-color: #ef4444;' : ''}">
            <div>
              <div class="tv-upcoming-time" style="direction: rtl;">${formatSlotRange12H(b.startTime, b.endTime)}</div>
              <div style="color: #cbd5e1; font-size: 0.95rem; font-weight: 700; margin-top: 2px;">
                ${escapeHtml(b.customerName)}
              </div>
            </div>
            <div>${statusTag}</div>
          </div>
        `;
      }).join('');
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

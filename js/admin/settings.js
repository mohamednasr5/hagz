/**
 * settings.js - Admin Settings Module
 * Manages pitch metadata, day/night prices, hours, Telegram integration, and admin password changes.
 */

import { dbRefs, get, update } from '../firebase-config.js';
import { changeAdminPassword } from './auth.js';
import { showToast } from '../utils.js';

export async function initSettingsModule() {
  const form = document.getElementById('settingsForm');
  const passwordForm = document.getElementById('changePasswordForm');

  // Load existing settings
  try {
    const snap = await get(dbRefs.settings());
    const data = snap.val() || {};

    setInputValue('settingPitchName', data.pitchName || 'ملعب مركز شباب الأحمدية الخماسي');
    setInputValue('settingDayPrice', data.dayPrice || 120);
    setInputValue('settingNightPrice', data.nightPrice || 180);
    setInputValue('settingDayStart', data.dayStart || '06:00');
    setInputValue('settingNightStart', data.nightStart || '18:00');
    
    const bookingEnabledCheckbox = document.getElementById('settingBookingEnabled');
    if (bookingEnabledCheckbox) {
      bookingEnabledCheckbox.checked = data.bookingEnabled !== false;
    }

    setInputValue('settingTelegramBotToken', data.telegramBotToken ? '••••••••••••••••••••' : '');
    setInputValue('settingTelegramChannel', data.telegramChannel || '@AhmadiahPitchBot');

  } catch (err) {
    console.error('Error loading settings:', err);
  }

  // Handle general settings submission
  if (form && !form.dataset.initialized) {
    form.dataset.initialized = 'true';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const saveBtn = form.querySelector('button[type="submit"]');
      if (saveBtn) saveBtn.disabled = true;

      try {
        const pitchName = document.getElementById('settingPitchName').value.trim();
        const dayPrice = Number(document.getElementById('settingDayPrice').value) || 120;
        const nightPrice = Number(document.getElementById('settingNightPrice').value) || 180;
        const dayStart = document.getElementById('settingDayStart').value;
        const nightStart = document.getElementById('settingNightStart').value;
        const bookingEnabled = document.getElementById('settingBookingEnabled').checked;
        const telegramChannel = document.getElementById('settingTelegramChannel').value.trim();

        const updates = {
          pitchName,
          dayPrice,
          nightPrice,
          dayStart,
          nightStart,
          bookingEnabled,
          telegramChannel,
          updatedAt: Date.now()
        };

        const rawToken = document.getElementById('settingTelegramBotToken').value.trim();
        if (rawToken && !rawToken.includes('•••')) {
          updates.telegramBotToken = rawToken;
        }

        await update(dbRefs.settings(), updates);
        showToast('تم حفظ كافة إعدادات الملعب بنجاح!', 'success');
      } catch (err) {
        console.error('Error updating settings:', err);
        showToast('فشل حفظ الإعدادات، يرجى المحاولة ثانيةً', 'error');
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }

  // Handle password change submission
  if (passwordForm && !passwordForm.dataset.initialized) {
    passwordForm.dataset.initialized = 'true';
    passwordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPass = document.getElementById('currentAdminPassword').value;
      const newPass = document.getElementById('newAdminPassword').value;
      const confirmPass = document.getElementById('confirmAdminPassword').value;

      if (newPass !== confirmPass) {
        showToast('كلمة المرور الجديدة غير متطابقة', 'error');
        return;
      }

      const res = await changeAdminPassword(currentPass, newPass);
      if (res.success) {
        showToast('تم تغيير كلمة مرور الإدارة بنجاح!', 'success');
        passwordForm.reset();
      } else {
        showToast(res.message || 'فشل تغيير كلمة المرور', 'error');
      }
    });
  }
}

function setInputValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

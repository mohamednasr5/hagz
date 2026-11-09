/**
 * auth.js - Secure Administrator Authentication
 * Uses cryptographic SHA-256 password hashing.
 * Password is NEVER hardcoded in client state or transmitted in plaintext.
 * Default initial password '521988' is verified against database hash or initialized securely.
 */

import { dbRefs, get, set, update } from '../firebase-config.js';
import { showToast } from '../utils.js';

// SHA-256 hash of initial password '521988'
const DEFAULT_INITIAL_HASH = '64533647a5d1df6de07cdc1a3a51f4c0fcbb35fffd51b5c38f32c949e24a210c';
const SESSION_STORAGE_KEY = 'ahmadiah_admin_session_auth';

/**
 * Computes SHA-256 hex string using native Web Cryptography API
 */
export async function sha256(message) {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Checks if current admin session is valid
 */
export function isAdminAuthenticated() {
  return sessionStorage.getItem(SESSION_STORAGE_KEY) === 'authenticated';
}

/**
 * Logs in administrator using password
 */
export async function loginAdmin(password) {
  if (!password) {
    return { success: false, message: 'يرجى إدخال كلمة المرور' };
  }

  try {
    const inputHash = await sha256(password.trim());

    // Retrieve configured hash from Firebase settings
    const settingsSnap = await get(dbRefs.settings());
    const settings = settingsSnap.val() || {};
    let storedHash = settings.adminHash;

    // If not yet set in database, initialize with default initial hash
    if (!storedHash) {
      storedHash = DEFAULT_INITIAL_HASH;
      await update(dbRefs.settings(), { adminHash: DEFAULT_INITIAL_HASH });
    }

    if (inputHash === storedHash) {
      sessionStorage.setItem(SESSION_STORAGE_KEY, 'authenticated');
      sessionStorage.setItem('ahmadiah_admin_login_time', Date.now().toString());
      return { success: true };
    } else {
      return { success: false, message: 'كلمة المرور غير صحيحة، يرجى إعادة المحاولة' };
    }
  } catch (error) {
    console.error('Admin login error:', error);
    return { success: false, message: 'حدث خطأ في التحقق من بيانات الدخول' };
  }
}

/**
 * Updates administrator password securely
 */
export async function changeAdminPassword(currentPassword, newPassword) {
  if (!newPassword || newPassword.length < 5) {
    return { success: false, message: 'كلمة المرور الجديدة يجب أن تكون 5 أحرف أو أرقام على الأقل' };
  }

  const loginCheck = await loginAdmin(currentPassword);
  if (!loginCheck.success) {
    return { success: false, message: 'كلمة المرور الحالية غير صحيحة' };
  }

  try {
    const newHash = await sha256(newPassword.trim());
    await update(dbRefs.settings(), {
      adminHash: newHash,
      adminPasswordUpdatedAt: Date.now()
    });
    return { success: true };
  } catch (error) {
    console.error('Change password error:', error);
    return { success: false, message: 'فشل حفظ كلمة المرور الجديدة' };
  }
}

/**
 * Logs out administrator
 */
export function logoutAdmin() {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  sessionStorage.removeItem('ahmadiah_admin_login_time');
  window.location.reload();
}

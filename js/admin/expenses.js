/**
 * expenses.js - Expense Management Module
 * Tracks stadium operating expenses (electricity, lighting, maintenance, cleaning, equipment, misc)
 * Persists directly in Firebase Realtime Database and links with financial reports.
 */

import { dbRefs, push, set, update, remove, onValue } from '../firebase-config.js';
import { formatCurrency, formatEgyptDateKey, getEgyptNow, showToast } from '../utils.js';

let expensesByDate = {};
let activeDateListener = null;

export function initExpensesModule(selectedDateKey, onDataChanged) {
  if (activeDateListener) {
    activeDateListener();
    activeDateListener = null;
  }

  const expRef = dbRefs.expenses(selectedDateKey);
  activeDateListener = onValue(expRef, (snapshot) => {
    expensesByDate = snapshot.val() || {};
    renderExpensesList(selectedDateKey);
    if (onDataChanged) onDataChanged(expensesByDate);
  });

  setupExpenseModalListeners(selectedDateKey);
}

export function getExpensesForDate() {
  return expensesByDate;
}

/**
 * Renders the expense table for the current date
 */
export function renderExpensesList(dateKey) {
  const tbody = document.getElementById('expensesTableBody');
  const totalEl = document.getElementById('dailyTotalExpensesValue');
  if (!tbody) return;

  const entries = Object.entries(expensesByDate);
  let total = 0;

  if (entries.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: #94a3b8; padding: 24px;">
          لا توجد مصروفات مسجلة لهذا اليوم.
        </td>
      </tr>
    `;
    if (totalEl) totalEl.textContent = formatCurrency(0);
    return;
  }

  tbody.innerHTML = entries.map(([id, item]) => {
    const amount = Number(item.amount) || 0;
    total += amount;

    return `
      <tr>
        <td style="font-weight: 700; color: #fff;">${escapeHtml(item.title)}</td>
        <td>
          <span style="background: rgba(255,255,255,0.08); padding: 4px 10px; border-radius: 20px; font-size: 0.82rem;">
            ${getCategoryNameArabic(item.category)}
          </span>
        </td>
        <td style="font-weight: 800; color: var(--accent-red);">${formatCurrency(amount)}</td>
        <td style="color: #94a3b8; font-size: 0.85rem;">${escapeHtml(item.notes || '-')}</td>
        <td style="font-size: 0.82rem; color: #64748b;">${new Date(item.createdAt || Date.now()).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit', hour12: true })}</td>
        <td>
          <button class="btn-action cancel" onclick="window.handleDeleteExpense('${dateKey}', '${id}')">
            🗑️ حذف
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (totalEl) totalEl.textContent = formatCurrency(total);
}

function getCategoryNameArabic(category) {
  const map = {
    electricity: '⚡ كهرباء عامة',
    lighting: '💡 كشافات وإنارة الملعب',
    maintenance: '🛠️ صيانة وتجهيزات',
    cleaning: '🧹 نظافة ومطهرات',
    equipment: '⚽ كرات ومعدات',
    misc: '📦 متنوعة ونثريات'
  };
  return map[category] || category || 'عام';
}

function setupExpenseModalListeners(dateKey) {
  const form = document.getElementById('expenseForm');
  if (form && !form.dataset.initialized) {
    form.dataset.initialized = 'true';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('expenseTitle').value.trim();
      const amount = Number(document.getElementById('expenseAmount').value) || 0;
      const category = document.getElementById('expenseCategory').value;
      const notes = document.getElementById('expenseNotes').value.trim();
      const targetDate = document.getElementById('expenseDateInput').value || dateKey;

      if (!title || amount <= 0) {
        showToast('يرجى إدخال اسم المصروف وقيمة صالحة', 'error');
        return;
      }

      try {
        const expRef = push(dbRefs.expenses(targetDate));
        await set(expRef, {
          expenseId: expRef.key,
          title,
          amount,
          category,
          notes,
          date: targetDate,
          createdAt: Date.now()
        });

        form.reset();
        document.getElementById('expenseModal').classList.remove('active');
        showToast('تم تسجيل المصروف وخصمه من إيراد اليوم بنجاح!', 'success');
      } catch (err) {
        console.error('Error adding expense:', err);
        showToast('فشل تسجيل المصروف', 'error');
      }
    });
  }
}

window.handleDeleteExpense = async function(dateKey, expenseId) {
  if (!confirm('هل أنت متأكد من رغبتك في حذف هذا المصروف؟')) return;

  try {
    await remove(dbRefs.expenseItem(dateKey, expenseId));
    showToast('تم حذف المصروف بنجاح', 'success');
  } catch (err) {
    console.error('Error deleting expense:', err);
    showToast('فشل حذف المصروف', 'error');
  }
};

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

/**
 * reports.js - Monthly Financial Reports & Interactive Analytics
 * Aggregates all bookings and expenses across all months,
 * renders interactive SVG comparison charts, and exports reports to Excel/CSV.
 */

import { dbRefs, get } from '../firebase-config.js';
import { formatCurrency, showToast } from '../utils.js';

let monthlyAggregations = {};

/**
 * Loads and compiles all monthly financial reports across database
 */
export async function loadMonthlyReports() {
  const container = document.getElementById('monthlyReportsTableBody');
  if (container) {
    container.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #94a3b8; padding: 20px;">جارٍ تجميع التقارير الشهرية...</td></tr>`;
  }

  try {
    const [bookingsSnap, expensesSnap] = await Promise.all([
      get(dbRefs.bookings()),
      get(dbRefs.expenses())
    ]);

    const allBookings = bookingsSnap.val() || {};
    const allExpenses = expensesSnap.val() || {};

    const monthsMap = {};

    // Group Bookings by Month (YYYY-MM)
    for (const [dateKey, dayBookings] of Object.entries(allBookings)) {
      const monthKey = dateKey.substring(0, 7); // YYYY-MM
      if (!monthsMap[monthKey]) {
        monthsMap[monthKey] = {
          monthKey,
          totalBookings: 0,
          totalHours: 0,
          collectedRevenue: 0,
          totalContracted: 0,
          dayRevenue: 0,
          nightRevenue: 0,
          totalExpenses: 0,
          outstanding: 0,
          netIncome: 0
        };
      }

      for (const [id, b] of Object.entries(dayBookings)) {
        if (b.status === 'cancelled') continue;

        monthsMap[monthKey].totalBookings++;
        const h = (Number(b.durationMinutes) || 60) / 60;
        monthsMap[monthKey].totalHours += h;

        const total = Number(b.totalPrice) || 0;
        const paid = Number(b.paidAmount) || 0;
        monthsMap[monthKey].totalContracted += total;
        monthsMap[monthKey].collectedRevenue += paid;
        monthsMap[monthKey].outstanding += Math.max(0, total - paid);

        const isNight = (b.period || '').includes('ليل');
        if (isNight) {
          monthsMap[monthKey].nightRevenue += paid;
        } else {
          monthsMap[monthKey].dayRevenue += paid;
        }
      }
    }

    // Group Expenses by Month
    for (const [dateKey, dayExpenses] of Object.entries(allExpenses)) {
      const monthKey = dateKey.substring(0, 7);
      if (!monthsMap[monthKey]) {
        monthsMap[monthKey] = {
          monthKey,
          totalBookings: 0,
          totalHours: 0,
          collectedRevenue: 0,
          totalContracted: 0,
          dayRevenue: 0,
          nightRevenue: 0,
          totalExpenses: 0,
          outstanding: 0,
          netIncome: 0
        };
      }

      for (const [id, exp] of Object.entries(dayExpenses)) {
        monthsMap[monthKey].totalExpenses += (Number(exp.amount) || 0);
      }
    }

    // Compute Net Income for each month
    for (const key of Object.keys(monthsMap)) {
      monthsMap[key].netIncome = monthsMap[key].collectedRevenue - monthsMap[key].totalExpenses;
    }

    monthlyAggregations = monthsMap;
    renderMonthlyTable();
    renderCharts();

  } catch (err) {
    console.error('Error generating monthly reports:', err);
    if (container) {
      container.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #ef4444; padding: 20px;">تعذر تحميل التقارير</td></tr>`;
    }
  }
}

function renderMonthlyTable() {
  const container = document.getElementById('monthlyReportsTableBody');
  if (!container) return;

  const sortedMonths = Object.keys(monthlyAggregations).sort().reverse();

  if (sortedMonths.length === 0) {
    container.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #94a3b8; padding: 20px;">لا توجد سجلات مالية بعد</td></tr>`;
    return;
  }

  container.innerHTML = sortedMonths.map((mKey) => {
    const m = monthlyAggregations[mKey];
    const [y, mm] = mKey.split('-');
    const monthArabic = new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric' }).format(new Date(y, mm - 1, 1));

    return `
      <tr>
        <td style="font-weight: 800; color: #fff;">${monthArabic}</td>
        <td>${m.totalBookings} حجز</td>
        <td>${m.totalHours.toFixed(1)} ساعة</td>
        <td style="color: var(--accent-green); font-weight: 800;">${formatCurrency(m.collectedRevenue)}</td>
        <td style="color: var(--accent-red); font-weight: 700;">${formatCurrency(m.totalExpenses)}</td>
        <td style="font-weight: 900; color: ${m.netIncome >= 0 ? '#34d399' : '#f87171'};">${formatCurrency(m.netIncome)}</td>
        <td style="color: var(--accent-yellow);">${formatCurrency(m.outstanding)}</td>
        <td>
          <button class="btn-action edit" onclick="window.exportSingleMonthCSV('${mKey}')">
            📊 تصدير
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Draws High-Definition SVG Financial Charts
 */
function renderCharts() {
  const chartCanvas = document.getElementById('financialOverviewChart');
  const dayNightCanvas = document.getElementById('dayNightRatioChart');

  const months = Object.keys(monthlyAggregations).sort();
  if (months.length === 0) return;

  // Render Revenue vs Expense vs Net Bar Chart in SVG
  if (chartCanvas) {
    const maxVal = Math.max(...months.map(m => Math.max(
      monthlyAggregations[m].collectedRevenue,
      monthlyAggregations[m].totalExpenses,
      Math.abs(monthlyAggregations[m].netIncome)
    )), 100);

    const barWidth = 24;
    const gap = 16;
    const groupWidth = barWidth * 3 + gap;
    const svgWidth = Math.max(500, months.length * groupWidth + 80);
    const svgHeight = 260;
    const chartHeight = 180;

    let barsHtml = '';

    months.forEach((mKey, idx) => {
      const data = monthlyAggregations[mKey];
      const x = 50 + idx * groupWidth;

      const revH = (data.collectedRevenue / maxVal) * chartHeight;
      const expH = (data.totalExpenses / maxVal) * chartHeight;
      const netH = Math.max(0, (data.netIncome / maxVal) * chartHeight);

      const yRev = svgHeight - 40 - revH;
      const yExp = svgHeight - 40 - expH;
      const yNet = svgHeight - 40 - netH;

      barsHtml += `
        <!-- Month Label -->
        <text x="${x + barWidth * 1.5}" y="${svgHeight - 16}" fill="#94a3b8" font-size="11" text-anchor="middle" font-family="Cairo">${mKey}</text>
        <!-- Revenue Bar -->
        <rect x="${x}" y="${yRev}" width="${barWidth}" height="${revH}" rx="4" fill="#10b981">
          <title>الإيراد المحصل: ${data.collectedRevenue} ج.م</title>
        </rect>
        <!-- Expense Bar -->
        <rect x="${x + barWidth + 3}" y="${yExp}" width="${barWidth}" height="${expH}" rx="4" fill="#ef4444">
          <title>المصروفات: ${data.totalExpenses} ج.م</title>
        </rect>
        <!-- Net Income Bar -->
        <rect x="${x + (barWidth + 3) * 2}" y="${yNet}" width="${barWidth}" height="${netH}" rx="4" fill="#3b82f6">
          <title>الصافي: ${data.netIncome} ج.م</title>
        </rect>
      `;
    });

    chartCanvas.innerHTML = `
      <svg viewBox="0 0 ${svgWidth} ${svgHeight}" style="width: 100%; height: 260px;">
        <line x1="40" y1="${svgHeight - 40}" x2="${svgWidth - 20}" y2="${svgHeight - 40}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
        ${barsHtml}
      </svg>
    `;
  }

  // Render Day vs Night Revenue Split Chart
  if (dayNightCanvas) {
    let totalDay = 0;
    let totalNight = 0;
    months.forEach(k => {
      totalDay += monthlyAggregations[k].dayRevenue;
      totalNight += monthlyAggregations[k].nightRevenue;
    });

    const sum = totalDay + totalNight || 1;
    const dayPercent = Math.round((totalDay / sum) * 100);
    const nightPercent = 100 - dayPercent;

    dayNightCanvas.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 16px; padding: 20px;">
        <div>
          <div style="display: flex; justify-content: space-between; font-size: 0.95rem; margin-bottom: 6px;">
            <span>☀️ إيراد الفترات النهارية</span>
            <strong style="color: #fbbf24;">${formatCurrency(totalDay)} (${dayPercent}%)</strong>
          </div>
          <div style="width: 100%; height: 14px; background: rgba(0,0,0,0.4); border-radius: 8px; overflow: hidden;">
            <div style="width: ${dayPercent}%; height: 100%; background: #fbbf24;"></div>
          </div>
        </div>

        <div>
          <div style="display: flex; justify-content: space-between; font-size: 0.95rem; margin-bottom: 6px;">
            <span>🌙 إيراد الفترات الليلية (الكشافات)</span>
            <strong style="color: #818cf8;">${formatCurrency(totalNight)} (${nightPercent}%)</strong>
          </div>
          <div style="width: 100%; height: 14px; background: rgba(0,0,0,0.4); border-radius: 8px; overflow: hidden;">
            <div style="width: ${nightPercent}%; height: 100%; background: #818cf8;"></div>
          </div>
        </div>
      </div>
    `;
  }
}

/**
 * Exports All Financial Reports to CSV format with UTF-8 BOM
 */
export function exportAllReportsCSV() {
  const months = Object.keys(monthlyAggregations).sort();
  if (months.length === 0) {
    showToast('لا توجد بيانات متاحة للتصدير', 'error');
    return;
  }

  let csvContent = '\uFEFF'; // UTF-8 Byte Order Mark for Arabic Excel compatibility
  csvContent += 'الشهر,عدد الحجوزات,ساعات التشغيل,إجمالي الإيراد المحصل,إجمالي المصروفات,صافي الدخل,المبالغ المتبقية\n';

  months.forEach(k => {
    const m = monthlyAggregations[k];
    csvContent += `"${k}",${m.totalBookings},${m.totalHours.toFixed(1)},${m.collectedRevenue},${m.totalExpenses},${m.netIncome},${m.outstanding}\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `تقرير_ملعب_الأحمدية_المالي_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('تم تصدير التقرير المالي بنجاح إلى ملف CSV/Excel!', 'success');
}

window.exportSingleMonthCSV = function(monthKey) {
  const m = monthlyAggregations[monthKey];
  if (!m) return;

  let csv = '\uFEFF';
  csv += 'بيان التقرير المالي,القيمة\n';
  csv += `الشهر,"${monthKey}"\n`;
  csv += `عدد الحجوزات,${m.totalBookings}\n`;
  csv += `ساعات التشغيل,${m.totalHours}\n`;
  csv += `الإيراد المحصل,${m.collectedRevenue}\n`;
  csv += `المصروفات,${m.totalExpenses}\n`;
  csv += `صافي الدخل,${m.netIncome}\n`;
  csv += `المبالغ المتبقية,${m.outstanding}\n`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `تقرير_شهر_${monthKey}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

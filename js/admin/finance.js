/**
 * finance.js - Complete Financial Management System
 * Computes exact daily & monthly accounting.
 * Net Income Formula:
 * Net Income = Total Cash Collected - Daily Expenses
 * (Unpaid booking amounts are strictly excluded from collected income!)
 */

import { formatCurrency, getArabicDayName, formatArabicFullDate } from '../utils.js';

/**
 * Computes daily financial totals from bookings and expenses
 */
export function calculateDailyFinances(bookingsObj = {}, expensesObj = {}) {
  let totalBookings = 0;
  let totalBookedHours = 0;
  let totalContractedRevenue = 0;
  let totalCashCollected = 0;
  let totalBookingRevenue = 0;
  let totalOtherIncome = 0;
  let totalOutstanding = 0;

  for (const [id, b] of Object.entries(bookingsObj)) {
    if (b.status !== 'confirmed') continue;

    totalBookings++;
    const hours = (Number(b.durationMinutes) || 60) / 60;
    totalBookedHours += hours;

    const totalPrice = Number(b.totalPrice) || 0;
    const paidAmount = Number(b.paidAmount) || 0;
    const remaining = Math.max(0, totalPrice - paidAmount);

    totalContractedRevenue += totalPrice;
    totalBookingRevenue += paidAmount;
    totalCashCollected += paidAmount;
    totalOutstanding += remaining;
  }

  let totalExpenses = 0;
  for (const exp of Object.values(expensesObj || {})) {
    if (exp.type === 'income') totalOtherIncome += Number(exp.amount) || 0;
    else totalExpenses += Number(exp.amount) || 0;
  }

  // Manager salary is 10% of gross collected income (bookings + other income).
  const grossCollectedIncome = totalCashCollected + totalOtherIncome;
  const managerSalary = grossCollectedIncome * 0.10;
  // Net income excludes unpaid booking balances and deducts operating expenses + manager salary.
  const netDailyIncome = grossCollectedIncome - totalExpenses - managerSalary;

  return {
    totalBookings,
    totalBookedHours: Number(totalBookedHours.toFixed(1)),
    totalContractedRevenue,
    totalCashCollected,
    totalBookingRevenue,
    totalOtherIncome,
    totalOutstanding,
    totalExpenses,
    managerSalary,
    grossCollectedIncome,
    netDailyIncome
  };
}

/**
 * Renders the daily financial summary card & ledger in Admin UI
 */
export function renderDailyFinancialReport(dateKey, finances) {
  const dayNameEl = document.getElementById('finReportDayName');
  const dateStrEl = document.getElementById('finReportDateStr');
  const bookingsCountEl = document.getElementById('finReportBookingsCount');
  const hoursEl = document.getElementById('finReportHours');
  const contractRevEl = document.getElementById('finReportContractRev');
  const cashCollectedEl = document.getElementById('finReportCashCollected');
  const outstandingEl = document.getElementById('finReportOutstanding');
  const expensesEl = document.getElementById('finReportExpenses');
  const netIncomeEl = document.getElementById('finReportNetIncome');

  if (dayNameEl) dayNameEl.textContent = getArabicDayName(new Date(dateKey));
  if (dateStrEl) dateStrEl.textContent = formatArabicFullDate(new Date(dateKey));
  if (bookingsCountEl) bookingsCountEl.textContent = `${finances.totalBookings} حجز`;
  if (hoursEl) hoursEl.textContent = `${finances.totalBookedHours} ساعة`;
  if (contractRevEl) contractRevEl.textContent = formatCurrency(finances.totalContractedRevenue);
  if (cashCollectedEl) cashCollectedEl.textContent = formatCurrency(finances.totalCashCollected);
  if (outstandingEl) outstandingEl.textContent = formatCurrency(finances.totalOutstanding);
  if (expensesEl) expensesEl.textContent = formatCurrency(finances.totalExpenses);
  const otherIncomeEl = document.getElementById('finReportOtherIncome');
  if (otherIncomeEl) otherIncomeEl.textContent = formatCurrency(finances.totalOtherIncome);
  
  const managerSalaryEl = document.getElementById('finReportManagerSalary');
  if (managerSalaryEl) managerSalaryEl.textContent = formatCurrency(finances.managerSalary || 0);

  if (netIncomeEl) {
    netIncomeEl.textContent = formatCurrency(finances.netDailyIncome);
    netIncomeEl.style.color = finances.netDailyIncome >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
  }
}

/** Detailed financial ledger reports with date filters, CSV export and A4 print/PDF. */
import { dbRefs, get } from '../firebase-config.js';
import { formatCurrency, showToast } from '../utils.js';

let allBookings = {}, allExpenses = {}, currentRows = [];
let activePeriod = 'day';
const $ = id => document.getElementById(id);
const n = value => Number(value) || 0;
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todayKey = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dateObj = key => { const [y,m,d]=key.split('-').map(Number); return new Date(y,m-1,d,12); };
const keyOf = date => [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
const shift = (date,days) => { const d=new Date(date); d.setDate(d.getDate()+days); return d; };
const money = value => formatCurrency(value);
const plainMoney = value => n(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const categoryNames = {lighting:'كشافات وإنارة',electricity:'كهرباء عامة',maintenance:'صيانة وتجهيزات',cleaning:'نظافة ومطهرات',equipment:'كرات ومعدات',misc:'نثريات ومتنوع',other:'إيرادات أخرى'};
const periodName = {day:'تقرير اليوم',week:'التقرير الأسبوعي',month:'التقرير الشهري',year:'التقرير السنوي',custom:'تقرير الفترة المحددة'};

export async function loadMonthlyReports() {
  const label=$('reportPeriodLabel');
  if(label) label.textContent='جارٍ تحميل السجلات المالية...';
  try {
    const [b,e]=await Promise.all([get(dbRefs.bookings()),get(dbRefs.expenses())]);
    allBookings=b.val()||{}; allExpenses=e.val()||{};
    bindReportControls(); setPreset('day');
  } catch(error) {
    console.error('Financial reports load failed:',error);
    showToast('تعذر تحميل بيانات التقارير المالية','error');
    if(label) label.textContent='تعذر تحميل البيانات. تحقق من اتصال قاعدة البيانات.';
  }
}
function bindReportControls(){
  if($('reportFromDate')?.dataset.bound) return;
  document.querySelectorAll('.report-preset').forEach(btn=>btn.addEventListener('click',()=>setPreset(btn.dataset.period)));
  $('applyReportFilterBtn')?.addEventListener('click',()=>{
    activePeriod='custom';
    document.querySelectorAll('.report-preset').forEach(x=>x.classList.toggle('active',x.dataset.period==='custom'));
    renderSelectedRange();
  });
  $('printFinancialReportBtn')?.addEventListener('click',()=>{
    if(renderSelectedRange()) window.print();
  });
  $('exportFinancialReportCSVBtn')?.addEventListener('click',exportCurrentCSV);
  if($('reportFromDate')) $('reportFromDate').dataset.bound='1';
}
function setPreset(period){
  activePeriod=period;
  document.querySelectorAll('.report-preset').forEach(x=>x.classList.toggle('active',x.dataset.period===period));
  const today=dateObj(todayKey()); let from=new Date(today),to=new Date(today);
  if(period==='week'){const day=(today.getDay()+6)%7;from=shift(today,-day);}
  if(period==='month') from=new Date(today.getFullYear(),today.getMonth(),1,12);
  if(period==='year') from=new Date(today.getFullYear(),0,1,12);
  if(period==='custom'){from=dateObj($('reportFromDate')?.value||todayKey());to=dateObj($('reportToDate')?.value||todayKey());}
  if($('reportFromDate')) $('reportFromDate').value=keyOf(from);
  if($('reportToDate')) $('reportToDate').value=keyOf(to);
  renderSelectedRange();
}
function renderSelectedRange(){
  const from=$('reportFromDate')?.value, to=$('reportToDate')?.value;
  if(!from||!to||from>to){showToast('حدد تاريخ بداية ونهاية صحيحين','error');return false;}
  const bookings=[],transactions=[];
  let bookingsCount=0,hours=0,contracted=0,bookingIncome=0,outstanding=0,expenses=0,otherIncome=0;

  for(const [date,day] of Object.entries(allBookings)){
    if(date<from||date>to||!day||typeof day!=='object') continue;
    for(const [id,b] of Object.entries(day)){
      if(!b||b.status!=='confirmed') continue;
      const total=n(b.totalPrice),paid=Math.min(total,n(b.paidAmount)),remaining=Math.max(0,total-paid);
      bookingsCount++;hours+=n(b.durationMinutes||60)/60;contracted+=total;bookingIncome+=paid;outstanding+=remaining;
      bookings.push({date,id,b,total,paid,remaining});
    }
  }
  for(const [date,day] of Object.entries(allExpenses)){
    if(date<from||date>to||!day||typeof day!=='object') continue;
    for(const [id,item] of Object.entries(day)){
      if(!item) continue;
      const amount=n(item.amount),income=item.type==='income';
      if(income) otherIncome+=amount; else expenses+=amount;
      transactions.push({date,id,item,amount,income});
    }
  }
  bookings.sort((a,b)=>a.date.localeCompare(b.date)||String(a.b.startTime||'').localeCompare(String(b.b.startTime||'')));
  transactions.sort((a,b)=>a.date.localeCompare(b.date));
  const revenueRows=[
    ...bookings.filter(x=>x.paid>0).map(x=>({date:x.date,item:'إيراد حجز ملعب',details:`${x.b.customerName||'حجز'} • ${x.b.startTime||''} - ${x.b.endTime||''} • المدفوع من ${plainMoney(x.total)} ج.م`,amount:x.paid})),
    ...transactions.filter(x=>x.income).map(x=>({date:x.date,item:x.item.title||'إيراد آخر',details:x.item.notes||categoryNames[x.item.category]||'إيراد إضافي',amount:x.amount}))
  ].sort((a,b)=>a.date.localeCompare(b.date));
  const totalRevenue=bookingIncome+otherIncome;
  const managerSalary=totalRevenue*0.10;
  const expenseRows=[
    ...transactions.filter(x=>!x.income).map(x=>({date:x.date,item:x.item.title||'مصروف',details:[categoryNames[x.item.category]||x.item.category||'عام',x.item.notes].filter(Boolean).join(' • '),amount:x.amount})),
    ...(managerSalary>0?[{date:from===to?from:`${from} — ${to}`,item:'راتب المسؤول عن إدارة الملعب الخماسي (10%)',details:`10% من إجمالي الإيرادات المحصلة البالغ ${plainMoney(totalRevenue)} ج.م`,amount:managerSalary,isManagerSalary:true}]:[])
  ];
  const totalDeductions=expenses+managerSalary;
  const net=totalRevenue-totalDeductions;
  const label=activePeriod==='custom'?periodName.custom:periodName[activePeriod]||'التقرير المالي';
  const range=from===to?from:`من ${from} إلى ${to}`;
  if($('reportPeriodLabel')) $('reportPeriodLabel').textContent=`${label} — ${range}`;
  if($('reportPrintPeriod')) $('reportPrintPeriod').textContent=`${label} | ${range}`;

  const renderLedger=(rows)=>rows.map((r,i)=>`<tr><td class="serial-cell">${i+1}</td><td dir="ltr">${safe(r.date)}</td><td class="ledger-item">${safe(r.item)}</td><td>${safe(r.details||'—')}</td><td class="ledger-amount">${plainMoney(r.amount)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty-ledger">لا توجد عمليات مسجلة خلال هذه الفترة</td></tr>';
  if($('reportRevenueDetail')) $('reportRevenueDetail').innerHTML=renderLedger(revenueRows);
  if($('reportExpenseDetail')) $('reportExpenseDetail').innerHTML=renderLedger(expenseRows);
  const set=(id,value)=>{if($(id))$(id).textContent=value;};
  set('reportRevenueTotal',plainMoney(totalRevenue));set('reportExpenseTotal',plainMoney(totalDeductions));
  set('reportSettlementRevenue',money(totalRevenue));set('reportSettlementExpenses',money(expenses));
  set('reportManagerSalary',money(managerSalary));set('reportTotalDeductions',money(totalDeductions));set('reportSettlementNet',money(net));
  set('rptBookingsCount',bookingsCount);set('rptHours',hours.toFixed(1)+' ساعة');set('rptContracted',money(contracted));set('rptOutstanding',money(outstanding));
  currentRows=[
    {type:'meta',from,to,totalRevenue,expenses,managerSalary,totalDeductions,net,bookingsCount,hours,contracted,outstanding},
    ...revenueRows.map(x=>({type:'إيراد',...x})),
    ...expenseRows.map(x=>({type:'مصروف',...x}))
  ];
  return true;
}
function exportCurrentCSV(){
  if(!currentRows.length){showToast('لا توجد بيانات للتصدير','error');return;}
  const csvCell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const lines=[['م','النوع','التاريخ','البند','التفاصيل','المبلغ (ج.م)']];
  let serial=0;
  for(const r of currentRows){
    if(r.type==='meta'){
      lines.push(['','إجمالي الإيرادات','','','',r.totalRevenue]);
      lines.push(['','مصروفات تشغيلية','','','',r.expenses]);
      lines.push(['','راتب مسؤول الملعب (10%)','','10% من إجمالي الإيرادات المحصلة','',r.managerSalary]);
      lines.push(['','إجمالي الاستقطاعات','','مصروفات + راتب المسؤول','',r.totalDeductions]);
      lines.push(['','صافي الإيراد','','(الإيرادات - جميع الاستقطاعات)','',r.net]);
    } else lines.push([++serial,r.type,r.date,r.item,r.details,r.amount]);
  }
  const blob=new Blob(['\uFEFF'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='كشف_الإيرادات_والمصروفات_'+todayKey()+'.csv';a.click();URL.revokeObjectURL(url);
}
window.exportSingleMonthCSV=function(monthKey){
  activePeriod='custom';$('reportFromDate').value=monthKey+'-01';
  $('reportToDate').value=monthKey+'-'+String(new Date(Number(monthKey.slice(0,4)),Number(monthKey.slice(5,7)),0).getDate()).padStart(2,'0');
  renderSelectedRange();exportCurrentCSV();
};
export function exportAllReportsCSV(){loadMonthlyReports();}

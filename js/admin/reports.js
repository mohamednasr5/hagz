/** Financial reports: date-range aggregation, detailed ledgers, CSV and A4 print/PDF. */
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
const categoryNames = {lighting:'كشافات وإنارة',electricity:'كهرباء عامة',maintenance:'صيانة وتجهيزات',cleaning:'نظافة ومطهرات',equipment:'كرات ومعدات',misc:'نثريات ومتنوع',other:'إيرادات أخرى'};
const periodName = {day:'تقرير اليوم',week:'التقرير الأسبوعي',month:'التقرير الشهري',year:'التقرير السنوي',custom:'تقرير الفترة المحددة'};

export async function loadMonthlyReports() {
  const label=$('reportPeriodLabel');
  if(label) label.textContent='جارٍ تحميل جميع السجلات المالية...';
  try {
    const [b,e]=await Promise.all([get(dbRefs.bookings()),get(dbRefs.expenses())]);
    allBookings=b.val()||{}; allExpenses=e.val()||{};
    bindReportControls();
    setPreset('day');
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
    activePeriod='custom'; document.querySelectorAll('.report-preset').forEach(x=>x.classList.toggle('active',x.dataset.period==='custom'));
    renderSelectedRange();
  });
  $('printFinancialReportBtn')?.addEventListener('click',()=>{renderSelectedRange();window.print();});
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
  if(!from||!to||from>to){showToast('حدد تاريخ بداية ونهاية صحيحين','error');return;}
  const rows=[];
  let bookingsCount=0,hours=0,contracted=0,bookingIncome=0,outstanding=0,expenses=0,otherIncome=0;
  const expenseGroups={},incomeGroups={};
  for(const [date,day] of Object.entries(allBookings)){
    if(date<from||date>to||!day||typeof day!=='object') continue;
    for(const [id,b] of Object.entries(day)){
      if(!b||b.status!=='confirmed') continue;
      const total=n(b.totalPrice),paid=Math.min(total,n(b.paidAmount)),remaining=Math.max(0,total-paid);
      bookingsCount++;hours+=n(b.durationMinutes||60)/60;contracted+=total;bookingIncome+=paid;outstanding+=remaining;
      rows.push({date,id,b,total,paid,remaining});
    }
  }
  const tx=[];
  for(const [date,day] of Object.entries(allExpenses)){
    if(date<from||date>to||!day||typeof day!=='object') continue;
    for(const [id,item] of Object.entries(day)){
      if(!item) continue;
      const amount=n(item.amount),income=item.type==='income';
      if(income){otherIncome+=amount;const k=item.title||'إيرادات أخرى';incomeGroups[k]=(incomeGroups[k]||{count:0,total:0});incomeGroups[k].count++;incomeGroups[k].total+=amount;}
      else {expenses+=amount;const k=item.category||'misc';expenseGroups[k]=(expenseGroups[k]||{count:0,total:0});expenseGroups[k].count++;expenseGroups[k].total+=amount;}
      tx.push({date,id,item,amount,income});
    }
  }
  rows.sort((a,b)=>a.date.localeCompare(b.date)||String(a.b.startTime||'').localeCompare(String(b.b.startTime||'')));
  tx.sort((a,b)=>a.date.localeCompare(b.date));
  const net=bookingIncome+otherIncome-expenses;
  const label=activePeriod==='custom'?periodName.custom:periodName[activePeriod]||'التقرير المالي';
  const range=from===to?from:`من ${from} إلى ${to}`;
  if($('reportPeriodLabel')) $('reportPeriodLabel').textContent=`${label} — ${range}`;
  if($('reportPrintPeriod')) $('reportPrintPeriod').textContent=`${label} | ${range}`;
  const values={rptBookingIncome:money(bookingIncome),rptOtherIncome:money(otherIncome),rptExpenses:money(expenses),rptNet:money(net),rptBookingsCount:bookingsCount,rptHours:hours.toFixed(1)+' ساعة',rptContracted:money(contracted),rptOutstanding:money(outstanding)};
  Object.entries(values).forEach(([id,v])=>{if($(id))$(id).textContent=v;});
  const expenseBody=$('reportExpenseBreakdown'),incomeBody=$('reportIncomeBreakdown');
  const renderGroups=(groups,isIncome)=>Object.entries(groups).sort((a,b)=>b[1].total-a[1].total).map(([key,v])=>`<tr><td>${safe(categoryNames[key]||key)}</td><td>${v.count}</td><td style="color:${isIncome?'#34d399':'#f87171'};font-weight:800">${money(v.total)}</td></tr>`).join('')||'<tr><td colspan="3">لا توجد عمليات خلال الفترة</td></tr>';
  if(expenseBody)expenseBody.innerHTML=renderGroups(expenseGroups,false);
  if(incomeBody)incomeBody.innerHTML=renderGroups(incomeGroups,true);
  const bookingBody=$('reportBookingsDetail');
  if(bookingBody)bookingBody.innerHTML=rows.map(({date,b,total,paid,remaining})=>`<tr><td>${date}</td><td>${safe(b.customerName||'—')}</td><td>${safe(b.startTime||'—')} - ${safe(b.endTime||'—')}</td><td>${money(total)}</td><td style="color:#059669">${money(paid)}</td><td style="color:#b45309">${money(remaining)}</td></tr>`).join('')||'<tr><td colspan="6">لا توجد حجوزات مؤكدة خلال الفترة</td></tr>';
  const txBody=$('reportTransactionsDetail');
  if(txBody)txBody.innerHTML=tx.map(({date,item,amount,income})=>`<tr><td>${date}</td><td style="color:${income?'#059669':'#b91c1c'}">${income?'إيراد':'مصروف'}</td><td>${safe(item.title||'—')}</td><td>${safe(categoryNames[item.category]||item.category||'عام')}</td><td style="font-weight:800">${money(amount)}</td><td>${safe(item.notes||'—')}</td></tr>`).join('')||'<tr><td colspan="6">لا توجد عمليات أخرى خلال الفترة</td></tr>';
  currentRows=[{type:'summary',from,to,bookingsCount,hours,contracted,bookingIncome,otherIncome,expenses,net,outstanding},...rows.map(x=>({type:'booking',...x})),...tx.map(x=>({type:x.income?'income':'expense',...x}))];
}
function exportCurrentCSV(){
  if(!currentRows.length){showToast('لا توجد بيانات للتصدير','error');return;}
  const csvCell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const lines=[['النوع','التاريخ','البيان','التصنيف','القيمة','المحصل','المتبقي','ملاحظات']];
  for(const r of currentRows){
    if(r.type==='summary') lines.push(['ملخص',r.from+' - '+r.to,'عدد الحجوزات: '+r.bookingsCount+' | ساعات: '+r.hours,'الإيرادات المحصلة: '+r.bookingIncome+' | الإيرادات الأخرى: '+r.otherIncome+' | المصروفات: '+r.expenses+' | الصافي: '+r.net+' | المتبقي: '+r.outstanding,'','','','']);
    else if(r.type==='booking') lines.push(['حجز',r.date,r.b.customerName,'حجز ملعب',r.total,r.paid,r.remaining,r.b.notes||'']);
    else lines.push([r.type==='income'?'إيراد':'مصروف',r.date,r.item.title,categoryNames[r.item.category]||r.item.category,r.amount,'','',''+(r.item.notes||'')]);
  }
  const blob=new Blob(['\uFEFF'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='تقرير_ملعب_الأحمدية_'+todayKey()+'.csv';a.click();URL.revokeObjectURL(url);
}
window.exportSingleMonthCSV=function(monthKey){setPreset('custom');$('reportFromDate').value=monthKey+'-01';$('reportToDate').value=monthKey+'-'+new Date(Number(monthKey.slice(0,4)),Number(monthKey.slice(5,7)),0).getDate();renderSelectedRange();exportCurrentCSV();};
export function exportAllReportsCSV(){loadMonthlyReports();}

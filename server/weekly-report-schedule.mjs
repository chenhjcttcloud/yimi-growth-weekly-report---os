export const shiftDate=(date,days)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
export function fridayOfWeek(date){const day=new Date(date+'T00:00:00Z').getUTCDay()||7;return shiftDate(date,5-day);}
export function monthFridays(month){const [y,m]=month.split('-').map(Number),result=[];for(let d=new Date(Date.UTC(y,m-1,1));d.getUTCMonth()===m-1;d.setUTCDate(d.getUTCDate()+1))if(d.getUTCDay()===5)result.push(d.toISOString().slice(0,10));return result;}
export function isCalendarWorkday(date,calendar={}){
 if((calendar.workdayOverrides||[]).includes(date))return true;
 if((calendar.holidayDates||[]).includes(date))return false;
 const day=new Date(date+'T00:00:00Z').getUTCDay();return day!==0&&day!==6;
}

// Keep the original Friday as the week/month identity. Only its submission deadline moves.
export function weeklyReportSchedule(end,calendar={},time='20:00'){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(end)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('invalid_weekly_schedule');
 const friday=fridayOfWeek(end),start=shiftDate(friday,-4),sunday=shiftDate(friday,2);
 const known=Number(calendar.year)===Number(friday.slice(0,4))||(calendar.years||[]).includes(Number(friday.slice(0,4)));
 const calendarPending=Boolean(calendar.autoManaged&&!known);
 const workdays=Array.from({length:7},(_,i)=>shiftDate(start,i)).filter(d=>isCalendarWorkday(d,calendar));
 if(!workdays.length&&!calendarPending)return {weekEnd:end,start,deadlineDate:null,dueAt:null,exempt:true,reason:'holiday_week',calendarPending:false};
 const holidays=new Set(calendar.holidayDates||[]),beforeHolidays=[];
 for(const day of [...holidays].sort()){
  if(day<start||day>shiftDate(sunday,1)||holidays.has(shiftDate(day,-1)))continue;
  let previous=shiftDate(day,-1),guard=0;
  while(!isCalendarWorkday(previous,calendar)&&guard++<31)previous=shiftDate(previous,-1);
  if(previous>=start&&previous<=sunday&&isCalendarWorkday(previous,calendar))beforeHolidays.push(previous);
 }
 let deadlineDate=end,reason='normal_friday';
 if(beforeHolidays.length){deadlineDate=beforeHolidays.sort().at(-1);reason='pre_holiday';}
 else if(workdays.at(-1)>end){deadlineDate=workdays.at(-1);reason='adjusted_workday';}
 else if(!isCalendarWorkday(end,calendar)&&workdays.length){deadlineDate=workdays.filter(d=>d<=end).at(-1)||workdays.at(-1);reason='adjusted_workday';}
 return {weekEnd:end,start,deadlineDate,dueAt:`${deadlineDate}T${time}:00+08:00`,exempt:false,reason,calendarPending};
}

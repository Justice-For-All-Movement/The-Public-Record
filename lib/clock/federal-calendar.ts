/**
 * Federal working-day calendar.
 *
 * Legal public holidays are computed from 5 U.S.C. § 6103(a) with the
 * observed-day rule for most federal employees (Saturday -> preceding Friday,
 * Sunday -> following Monday; 5 U.S.C. § 6103(b) and E.O. 11582).
 * Inauguration Day is excluded (it applies only to employees in the
 * Washington, D.C. area). One-off closures ordered by the President must be
 * supplied from a reviewed source; the calendar never guesses them.
 */
export type IsoDate = string;
export interface FederalHoliday {date:IsoDate;name:string;observed:boolean}
export interface AdditionalClosure {date:IsoDate;reason:string;sourceUrl:string}

const DAY=86400000;
export function parseIsoDate(value:unknown):Date {
  if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))throw new RangeError("Invalid calendar date");
  const d=new Date(value+"T00:00:00Z");
  if(Number.isNaN(d.getTime()) || d.toISOString().slice(0,10)!==value)throw new RangeError("Invalid calendar date");
  const y=d.getUTCFullYear();
  if(y<1990 || y>2200)throw new RangeError("Date outside supported range");
  return d;
}
export function isValidIsoDate(value:unknown):value is IsoDate {
  try{parseIsoDate(value);return true;}catch{return false;}
}
export function toIso(d:Date):IsoDate {return d.toISOString().slice(0,10);}
export function addCalendarDays(date:IsoDate,days:number):IsoDate {
  return toIso(new Date(parseIsoDate(date).getTime()+days*DAY));
}
export function calendarDaysBetween(from:IsoDate,to:IsoDate):number {
  return Math.round((parseIsoDate(to).getTime()-parseIsoDate(from).getTime())/DAY);
}
function ymd(y:number,m:number,d:number):Date {return new Date(Date.UTC(y,m-1,d));}
function nthWeekday(y:number,month:number,weekday:number,n:number):Date {
  const first=ymd(y,month,1);
  const offset=(weekday-first.getUTCDay()+7)%7;
  return ymd(y,month,1+offset+(n-1)*7);
}
function lastWeekday(y:number,month:number,weekday:number):Date {
  const last=ymd(y,month+1,0);
  const offset=(last.getUTCDay()-weekday+7)%7;
  return ymd(y,month,last.getUTCDate()-offset);
}
function observedFixed(y:number,m:number,d:number,name:string):FederalHoliday {
  const actual=ymd(y,m,d);
  const dow=actual.getUTCDay();
  if(dow===6)return {date:toIso(new Date(actual.getTime()-DAY)),name,observed:true};
  if(dow===0)return {date:toIso(new Date(actual.getTime()+DAY)),name,observed:true};
  return {date:toIso(actual),name,observed:false};
}
function holidaysByRule(y:number):FederalHoliday[] {
  const list:FederalHoliday[]=[
    observedFixed(y,1,1,"New Year's Day"),
    {date:toIso(nthWeekday(y,1,1,3)),name:"Birthday of Martin Luther King, Jr.",observed:false},
    {date:toIso(nthWeekday(y,2,1,3)),name:"Washington's Birthday",observed:false},
    {date:toIso(lastWeekday(y,5,1)),name:"Memorial Day",observed:false},
    observedFixed(y,7,4,"Independence Day"),
    {date:toIso(nthWeekday(y,9,1,1)),name:"Labor Day",observed:false},
    {date:toIso(nthWeekday(y,10,1,2)),name:"Columbus Day",observed:false},
    observedFixed(y,11,11,"Veterans Day"),
    {date:toIso(nthWeekday(y,11,4,4)),name:"Thanksgiving Day",observed:false},
    observedFixed(y,12,25,"Christmas Day")
  ];
  // Juneteenth National Independence Day Act, Pub. L. 117-17 (June 17, 2021).
  if(y>=2021)list.push(observedFixed(y,6,19,"Juneteenth National Independence Day"));
  return list;
}
/** Holidays whose observed date falls within `year` (e.g. 2022-01-01 observed 2021-12-31). */
export function federalHolidays(year:number):FederalHoliday[] {
  if(!Number.isSafeInteger(year) || year<1990 || year>2200)throw new RangeError("Year outside supported range");
  return [...holidaysByRule(year),...holidaysByRule(year+1)]
    .filter(h=>h.date.startsWith(String(year)+"-"))
    .sort((a,b)=>a.date.localeCompare(b.date));
}

export interface WorkingDayCalendar {
  isWorkingDay(date:IsoDate):boolean;
  closureReason(date:IsoDate):string|null;
  readonly basis:string;
  readonly additionalClosures:readonly AdditionalClosure[];
}
export function createFederalCalendar(additionalClosures:readonly AdditionalClosure[]=[]):WorkingDayCalendar {
  for(const c of additionalClosures){
    parseIsoDate(c.date);
    if(!c.reason?.trim() || c.reason.length>200 || !/^https:\/\/[^\s]+$/.test(c.sourceUrl))
      throw new Error("Additional closures need a reason and an HTTPS source");
  }
  const extra=new Map(additionalClosures.map(c=>[c.date,c.reason]));
  const cache=new Map<number,Map<IsoDate,string>>();
  const yearMap=(y:number)=>{
    let m=cache.get(y);
    if(!m){m=new Map(federalHolidays(y).map(h=>[h.date,h.name+(h.observed?" (observed)":"")]));cache.set(y,m);}
    return m;
  };
  const closureReason=(date:IsoDate):string|null=>{
    const d=parseIsoDate(date);
    const dow=d.getUTCDay();
    if(dow===0||dow===6)return dow===0?"Sunday":"Saturday";
    return yearMap(d.getUTCFullYear()).get(date) ?? extra.get(date) ?? null;
  };
  return {
    isWorkingDay:date=>closureReason(date)===null,
    closureReason,
    basis:"Computed 5 U.S.C. § 6103 legal public holidays with observed-day rule"+
      (additionalClosures.length?` plus ${additionalClosures.length} reviewed additional closure(s)`:"")+
      "; other ad hoc closures are not included.",
    additionalClosures:Object.freeze([...additionalClosures])
  };
}

/** Date of the nth working day strictly after `start` (n >= 1), skipping excluded days. */
export function addWorkingDays(calendar:WorkingDayCalendar,start:IsoDate,n:number,excluded:(d:IsoDate)=>boolean=()=>false):IsoDate {
  if(!Number.isSafeInteger(n) || n<0 || n>2000)throw new RangeError("Invalid working-day count");
  let current=start,count=0;
  for(let guard=0;count<n;guard++){
    if(guard>5000)throw new RangeError("Working-day search exceeded bounds");
    current=addCalendarDays(current,1);
    if(calendar.isWorkingDay(current) && !excluded(current))count++;
  }
  return current;
}
/** Working days in (from, to], i.e. counting starts the day after `from`. */
export function workingDaysBetween(calendar:WorkingDayCalendar,from:IsoDate,to:IsoDate,excluded:(d:IsoDate)=>boolean=()=>false):number {
  if(calendarDaysBetween(from,to)>3660)throw new RangeError("Interval too long");
  let count=0;
  for(let d=addCalendarDays(from,1);d<=to;d=addCalendarDays(d,1))
    if(calendar.isWorkingDay(d) && !excluded(d))count++;
  return count;
}

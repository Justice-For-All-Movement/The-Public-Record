/**
 * TPR-24 — Federal FOIA working-day and appeal-clock estimator.
 *
 * Models 5 U.S.C. § 552(a)(6): 20 working days for a determination after the
 * appropriate component receives a request (at most 10 working days after a
 * designated component first receives a misrouted one); one information toll
 * and any needed fee-clarification tolls; unusual-circumstances written notice
 * of up to 10 more working days, beyond which an alternative timeframe is
 * needed; expedited-processing decisions within 10 calendar days; at least
 * 90 calendar days to appeal an adverse determination; and 20 working days to
 * decide an appeal.
 *
 * Output is a calendar ESTIMATE with its basis and uncertainty. It never
 * concludes that an agency acted unlawfully: backlogs, agency regulations,
 * litigation, agreed timeframes and facts not in the record all matter.
 */
import {addCalendarDays,addWorkingDays,calendarDaysBetween,isValidIsoDate,workingDaysBetween,
  type IsoDate,type WorkingDayCalendar} from "./federal-calendar";

export type ReceiptBasis = "agency_acknowledgment"|"agency_letter"|"portal_record"|"requester_estimate";
export interface ClockToll {
  kind:"information"|"fee";
  /** Date the agency asked the requester. */
  requestedOn:IsoDate;
  /** Date the requester responded; null while unresolved. */
  resolvedOn:IsoDate|null;
}
export type ClockExtension =
  | {kind:"unusual_circumstances";noticeOn:IsoDate;workingDays:number;writtenNotice:boolean}
  | {kind:"alternative_timeframe";agreedOn:IsoDate|null};
export interface ClockInput {
  today:IsoDate;
  /** Requester-reported submission date. */
  filedOn:IsoDate|null;
  /** Evidenced agency receipt by the appropriate component. */
  receivedOn:IsoDate|null;
  receiptBasis:ReceiptBasis|null;
  /** First receipt by any designated component when the request was routed. */
  firstDesignatedReceiptOn?:IsoDate|null;
  tolls?:readonly ClockToll[];
  extensions?:readonly ClockExtension[];
  expedited?:{requestedOn:IsoDate;decidedOn:IsoDate|null}|null;
  determination?:{on:IsoDate;adverse:boolean;statedAppealDeadline?:IsoDate|null}|null;
  appeal?:{filedOn:IsoDate;receivedOn:IsoDate|null;decidedOn:IsoDate|null}|null;
  /** Conflicting/disputed records about receipt or outcome. */
  disputed?:boolean;
}
export type DeterminationStatus =
  | "unknown_receipt"      // no filing or receipt date
  | "estimated"            // evidenced receipt, single estimate
  | "estimate_range"       // receipt approximated from filing date
  | "paused"               // an unresolved toll
  | "alternative_timeframe"// more than 10 extra working days without an agreed date
  | "determination_recorded"
  | "disputed"
  | "review_needed";
export interface DeterminationClock {
  status:DeterminationStatus;
  clockStartOn:IsoDate|null;
  clockStartLatestOn:IsoDate|null;
  dueOn:IsoDate|null;
  dueLatestOn:IsoDate|null;
  workingDaysCounted:number|null;
  workingDaysPaused:number;
  extensionWorkingDays:number;
  /** Neutral fact only: the estimated date is before `today` and no determination is recorded. */
  estimatedDatePassed:boolean;
}
export interface AppealClock {
  status:"not_applicable"|"window_open"|"minimum_window_passed"|"appeal_filed"|"appeal_decided";
  minimumWindowEndsOn:IsoDate|null;
  statedDeadline:IsoDate|null;
  decisionDueOn:IsoDate|null;
}
export interface ClockResult {
  verificationLevel:"evidenced"|"approximate"|"unknown";
  determination:DeterminationClock;
  expedited:{decisionDueOn:IsoDate|null;status:"not_requested"|"pending"|"decided"};
  appeal:AppealClock;
  elapsed:{calendarDaysSinceFiling:number|null;workingDaysSinceClockStart:number|null};
  notes:string[];
  basis:string;
  disclaimer:string;
}

export const CLOCK_DISCLAIMER="Calendar estimate only, not legal advice. Agency regulations, backlogs, agreed timeframes, " +
  "and facts not recorded here can change these dates. An estimated date passing does not by itself mean an agency acted improperly.";
const BASE_DAYS=20;

class ClockInputError extends Error {constructor(m:string){super(m);this.name="ClockInputError";}}
function date(v:unknown,label:string,allowNull=true):IsoDate|null {
  if(v===null || v===undefined){if(allowNull)return null;throw new ClockInputError(label+" is required");}
  if(!isValidIsoDate(v))throw new ClockInputError("Invalid "+label);
  return v;
}

export function computeFoiaClock(input:ClockInput,calendar:WorkingDayCalendar):ClockResult {
  const today=date(input.today,"today",false)!;
  const filedOn=date(input.filedOn,"filing date");
  const receivedOn=date(input.receivedOn,"receipt date");
  const firstDesignated=date(input.firstDesignatedReceiptOn,"first designated receipt date");
  const tolls=[...(input.tolls??[])];
  const extensions=[...(input.extensions??[])];
  if(tolls.length>20 || extensions.length>10)throw new ClockInputError("Too many clock events");
  for(const t of tolls){
    if(t.kind!=="information" && t.kind!=="fee")throw new ClockInputError("Invalid toll kind");
    date(t.requestedOn,"toll start",false);date(t.resolvedOn,"toll end");
    if(t.resolvedOn && t.resolvedOn<t.requestedOn)throw new ClockInputError("Toll ends before it starts");
  }
  const notes:string[]=[];
  if(receivedOn && input.receiptBasis===null)throw new ClockInputError("Receipt date needs a basis");
  if(filedOn && filedOn>today)throw new ClockInputError("Filing date is in the future");

  // ---- 1. When does the 20-day clock start?
  let verificationLevel:ClockResult["verificationLevel"]="unknown";
  let clockStart:IsoDate|null=null, clockStartLatest:IsoDate|null=null;
  const receiptEvidenced=receivedOn!==null && input.receiptBasis!=="requester_estimate";
  if(receivedOn){
    clockStart=receivedOn;
    verificationLevel=receiptEvidenced?"evidenced":"approximate";
    if(!receiptEvidenced)notes.push("Agency receipt date is the requester's estimate, not agency evidence.");
    if(firstDesignated){
      const ceiling=addWorkingDays(calendar,firstDesignated,10);
      if(ceiling<receivedOn){
        clockStart=ceiling;
        notes.push("Request was routed: the clock starts no later than 10 working days after the first designated component received it.");
      }
    }
  }else if(filedOn){
    // No agency evidence: bound receipt between filing and the routing ceiling.
    verificationLevel="approximate";
    clockStart=filedOn;
    clockStartLatest=addWorkingDays(calendar,filedOn,10);
    notes.push("Agency receipt is unverified; dates are a range from the reported filing date.");
  }else{
    notes.push("No filing or receipt date is recorded, so no date can be estimated.");
  }

  // ---- 2. Tolling: only the first information request tolls; fee tolls as needed.
  const ordered=[...tolls].sort((a,b)=>a.requestedOn.localeCompare(b.requestedOn));
  let infoSeen=false;
  const effective:ClockToll[]=[];
  for(const t of ordered){
    if(t.kind==="information"){
      if(infoSeen){notes.push("A second information request does not toll the clock under the statute; it is not excluded.");continue;}
      infoSeen=true;
    }
    if(clockStart && t.requestedOn<clockStart){notes.push("A pause dated before receipt was ignored.");continue;}
    effective.push(t);
  }
  const openToll=effective.find(t=>t.resolvedOn===null);
  // A day is excluded while the requester is answering (request date through the day before response).
  const paused=(d:IsoDate)=>effective.some(t=>d>t.requestedOn && (t.resolvedOn===null || d<=t.resolvedOn));
  const pausedResolved=(d:IsoDate)=>effective.some(t=>t.resolvedOn!==null && d>t.requestedOn && d<=t.resolvedOn);

  // ---- 3. Extensions.
  let extensionDays=0, alternative:ClockExtension|null=null;
  for(const e of extensions){
    if(e.kind==="unusual_circumstances"){
      date(e.noticeOn,"extension notice",false);
      if(!Number.isSafeInteger(e.workingDays) || e.workingDays<1 || e.workingDays>60)throw new ClockInputError("Invalid extension length");
      if(!e.writtenNotice){notes.push("An extension without written notice was not applied; review the agency correspondence.");continue;}
      if(extensionDays+e.workingDays>10){alternative=alternative??{kind:"alternative_timeframe",agreedOn:null};
        notes.push("Extensions beyond 10 working days require an alternative timeframe arranged with the requester.");continue;}
      extensionDays+=e.workingDays;
    }else if(e.kind==="alternative_timeframe"){
      date(e.agreedOn,"alternative timeframe date");
      alternative=e;
    }else throw new ClockInputError("Invalid extension kind");
  }

  // ---- 4. Determination clock.
  const det:DeterminationClock={status:"unknown_receipt",clockStartOn:clockStart,clockStartLatestOn:clockStartLatest,
    dueOn:null,dueLatestOn:null,workingDaysCounted:null,workingDaysPaused:0,extensionWorkingDays:extensionDays,estimatedDatePassed:false};
  const determination=input.determination??null;
  if(determination)date(determination.on,"determination date",false);
  if(input.disputed){
    det.status="disputed";
    notes.push("Records about this request conflict; no date is shown until they are reviewed.");
  }else if(clockStart){
    const limit=BASE_DAYS+extensionDays;
    const until=determination?.on ?? today;
    det.workingDaysCounted=until>clockStart?workingDaysBetween(calendar,clockStart,until,paused):0;
    det.workingDaysPaused=until>clockStart?workingDaysBetween(calendar,clockStart,until)-det.workingDaysCounted:0;
    if(alternative?.kind==="alternative_timeframe"){
      det.status="alternative_timeframe";
      det.dueOn=alternative.agreedOn;
      if(!alternative.agreedOn)notes.push("No agreed alternative date is recorded.");
    }else if(openToll && !determination &&
      openToll.requestedOn<=addWorkingDays(calendar,clockStart,limit,pausedResolved)){
      det.status="paused";
      notes.push(`The clock is paused while the requester answers a ${openToll.kind==="fee"?"fee":"clarification"} request.`);
    }else{
      det.dueOn=addWorkingDays(calendar,clockStart,limit,paused);
      if(clockStartLatest){det.dueLatestOn=addWorkingDays(calendar,clockStartLatest,limit,paused);det.status="estimate_range";}
      else det.status="estimated";
    }
    if(determination){
      det.status="determination_recorded";
    }else if(det.dueOn){
      det.estimatedDatePassed=(det.dueLatestOn??det.dueOn)<today;
    }
  }

  // ---- 5. Expedited processing decision (10 calendar days).
  let expedited:ClockResult["expedited"]={decisionDueOn:null,status:"not_requested"};
  if(input.expedited){
    const req=date(input.expedited.requestedOn,"expedited request date",false)!;
    expedited={decisionDueOn:addCalendarDays(req,10),status:input.expedited.decidedOn?"decided":"pending"};
  }

  // ---- 6. Administrative appeal.
  const appeal:AppealClock={status:"not_applicable",minimumWindowEndsOn:null,statedDeadline:null,decisionDueOn:null};
  if(determination?.adverse){
    appeal.minimumWindowEndsOn=addCalendarDays(determination.on,90);
    appeal.statedDeadline=date(determination.statedAppealDeadline,"stated appeal deadline");
    if(appeal.statedDeadline && appeal.statedDeadline<appeal.minimumWindowEndsOn)
      notes.push("The stated appeal deadline is earlier than the 90-day statutory minimum; review the letter and agency rules.");
    appeal.status=appeal.minimumWindowEndsOn<today?"minimum_window_passed":"window_open";
    if(input.appeal){
      const filed=date(input.appeal.filedOn,"appeal filing date",false)!;
      const rec=date(input.appeal.receivedOn,"appeal receipt date");
      appeal.decisionDueOn=addWorkingDays(calendar,rec??filed,BASE_DAYS);
      if(!rec)notes.push("Appeal receipt is unverified; the appeal decision estimate uses the filing date.");
      appeal.status=input.appeal.decidedOn?"appeal_decided":"appeal_filed";
    }else{
      notes.push("Always follow the appeal instructions in the agency's determination letter; agencies may allow longer than 90 days.");
    }
  }

  return {
    verificationLevel,
    determination:det,
    expedited,
    appeal,
    elapsed:{
      calendarDaysSinceFiling:filedOn?calendarDaysBetween(filedOn,today):null,
      workingDaysSinceClockStart:clockStart && clockStart<today?workingDaysBetween(calendar,clockStart,today):null
    },
    notes,
    basis:"5 U.S.C. § 552(a)(6). "+calendar.basis,
    disclaimer:CLOCK_DISCLAIMER
  };
}

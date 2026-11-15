import type {PoolClient} from "pg";
import {addCalendarDays,isValidIsoDate} from "../clock/federal-calendar";
import type {ClockResult} from "../clock/foia-clock";
import {enqueue,PermanentJobError,type LeasedJob} from "./outbox";

/**
 * Deadline reminders (TPR-25). Producers schedule from the member's own clock
 * estimate; the worker only sees the job payload (request id, kind, date),
 * never the draft or its history. Text is generated here, contains no
 * personal data, and repeats that dates are estimates.
 */
type ReminderKind="determination_estimate"|"appeal_minimum_window";
export function plannedReminders(draftId:string,clock:ClockResult,today:string):{key:string;kind:ReminderKind;date:string;runOn:string}[] {
  const out:{key:string;kind:ReminderKind;date:string;runOn:string}[]=[];
  const due=clock.determination.status==="determination_recorded"?null:(clock.determination.dueLatestOn??clock.determination.dueOn);
  if(due){const runOn=addCalendarDays(due,-2);if(runOn>=today)out.push({key:`deadline:${draftId}:det:${due}`,kind:"determination_estimate",date:due,runOn});}
  const appeal=clock.appeal.status==="window_open"?clock.appeal.minimumWindowEndsOn:null;
  if(appeal){const runOn=addCalendarDays(appeal,-14);if(runOn>=today)out.push({key:`deadline:${draftId}:appeal:${appeal}`,kind:"appeal_minimum_window",date:appeal,runOn});}
  return out;
}
export async function scheduleReminders(db:Pick<PoolClient,"query">,owner:string,draftId:string,clock:ClockResult,today:string):Promise<number> {
  let n=0;
  for(const r of plannedReminders(draftId,clock,today))
    if(await enqueue(db,owner,"deadline_reminder",r.key,{draftId,reminder:r.kind,date:r.date},new Date(r.runOn+"T14:00:00Z")))n++;
  return n;
}
export function reminderText(kind:unknown,date:string):{title:string;body:string} {
  if(kind==="appeal_minimum_window")return {title:"Appeal window reminder",
    body:`When this reminder was scheduled, the statutory minimum appeal window for your request ended on ${date}. Your agency's letter may allow longer. Check your request page and the letter before deciding.`};
  return {title:"Estimated response date approaching",
    body:`When this reminder was scheduled, the estimated determination date for your request was ${date}. This is an estimate, not a deadline the agency has missed. Check your request page for the current estimate.`};
}
/** Worker handler: writes an in-app notification unless the member opted out. */
export async function handleDeadlineReminder(db:PoolClient,job:LeasedJob):Promise<void> {
  const p=job.payload;
  if(typeof p.draftId!=="string" || !/^drf_[A-Za-z0-9_-]{16,40}$/.test(p.draftId) || !isValidIsoDate(p.date))
    throw new PermanentJobError("invalid_payload");
  const pref=await db.query<{deadline_reminders:boolean}>("SELECT deadline_reminders FROM tpr_private.notification_preferences WHERE owner_subject=$1",[job.owner]);
  if(pref.rows[0]?.deadline_reminders===false)return;
  const t=reminderText(p.reminder,p.date as string);
  await db.query(`INSERT INTO tpr_private.member_notifications(owner_subject,job_id,kind,title,body,link_path)
    VALUES($1,$2,'deadline_reminder',$3,$4,$5) ON CONFLICT (job_id) DO NOTHING`,[job.owner,job.id,t.title,t.body,"/me/drafts/"+p.draftId]);
}

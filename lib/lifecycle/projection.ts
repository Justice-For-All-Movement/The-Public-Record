/**
 * TPR-23 — Rebuild a request's status, timeline and clock inputs from its
 * immutable event history. The rebuild is deterministic regardless of the
 * order events arrive in; repeated deliveries are idempotent; conflicting or
 * premature events are surfaced, never silently merged.
 */
import type {IsoDate} from "../clock/federal-calendar";
import type {ClockExtension,ClockInput,ClockToll,ReceiptBasis} from "../clock/foia-clock";
import {LifecycleEventError,canonicalJson,validateEvent,validatePayload,type AssertedBy,type DeterminationOutcome,
  type LifecycleEvent,type LifecyclePayloads,type Verification} from "./events";

export type Stage = "adopted"|"drafted"|"filed"|"received"|"processing"|"interim_release"|"determined"|
  "appealed"|"appeal_decided"|"closed"|"withdrawn";
export type HistoryState = "applied"|"corrected"|"retracted"|"duplicate"|"awaiting_cause"|"rejected"|"correction";
export type ConflictKind = "conflicting_duplicate_id"|"invalid_correction"|"insufficient_correction_authority"|
  "competing_filing_dates"|"competing_determinations"|"precedes_filing"|"occurs_before_cause"|"appeal_without_adverse_determination"|
  "event_for_other_request";
export interface Conflict {kind:ConflictKind;eventIds:string[];message:string}
export interface StatusView {
  stage:Stage;
  label:string;
  assertedBy:AssertedBy;
  verification:Verification;
  observedOn:IsoDate;
  recordedAt:string;
  basisEventId:string;
  disputed:boolean;
}
export interface HistoryEntry {
  event:LifecycleEvent;
  state:HistoryState;
  /** The values in force after corrections (null when retracted/not applied). */
  effective:LifecycleEvent|null;
  correctedBy:string[];
}
export interface LifecycleFacts {
  filedOn:IsoDate|null;
  receivedOn:IsoDate|null;
  receiptVerification:Verification|null;
  agencyTrackingNumber:string|null;
  tolls:ClockToll[];
  extensions:ClockExtension[];
  expedited:{requestedOn:IsoDate;decidedOn:IsoDate|null;granted:boolean|null}|null;
  determination:{on:IsoDate;outcome:DeterminationOutcome;statedAppealDeadline:IsoDate|null;eventId:string}|null;
  appeal:{filedOn:IsoDate;receivedOn:IsoDate|null;decidedOn:IsoDate|null}|null;
  interimReleases:number;
}
export interface LifecycleProjection {
  requestId:string;
  status:StatusView|null;
  history:HistoryEntry[];
  conflicts:Conflict[];
  facts:LifecycleFacts;
  disputed:boolean;
}

const rank:Record<Verification,number>={self_reported:0,document_attached:1,reviewer_verified:2};
const stageOf:Partial<Record<LifecycleEvent["type"],Stage>>={
  adopted:"adopted",drafted:"drafted",filed:"filed",receipt_confirmed:"received",acknowledged:"received",
  clarification_requested:"processing",clarification_answered:"processing",fee_estimate_received:"processing",
  fee_response_sent:"processing",extension_notice:"processing",alternative_timeframe_agreed:"processing",
  referral:"processing",expedite_requested:"processing",expedite_decided:"processing",
  interim_release:"interim_release",final_determination:"determined",appeal_filed:"appealed",
  appeal_received:"appealed",appeal_determination:"appeal_decided",closed:"closed",reopened:"processing",withdrawn:"withdrawn"
};
const stageWords:Record<Stage,string>={adopted:"Adopted",drafted:"Drafted",filed:"Filed",received:"Received by agency",
  processing:"In process",interim_release:"Interim release",determined:"Determination issued",appealed:"Appealed",
  appeal_decided:"Appeal decided",closed:"Closed",withdrawn:"Withdrawn"};
/** Plain-language evidence wording. Only reviewer verification reads as confirmed. */
export function verificationWords(v:Verification,by:AssertedBy):string {
  if(v==="reviewer_verified")return "confirmed by a reviewer against agency records";
  if(v==="document_attached")return by==="agency_document"?"agency document attached, not yet reviewed":"document attached, not yet reviewed";
  return "reported by the requester";
}
const adverse=(o:DeterminationOutcome)=>o!=="full_grant";
const order=(a:LifecycleEvent,b:LifecycleEvent)=>a.occurredOn.localeCompare(b.occurredOn)||a.recordedAt.localeCompare(b.recordedAt)||a.id.localeCompare(b.id);
const byRecorded=(a:LifecycleEvent,b:LifecycleEvent)=>a.recordedAt.localeCompare(b.recordedAt)||a.id.localeCompare(b.id);
const stable=(e:LifecycleEvent)=>canonicalJson(e);

export function rebuildLifecycle(requestId:string,input:readonly LifecycleEvent[]):LifecycleProjection {
  if(input.length>5000)throw new LifecycleEventError("Event history too large");
  const conflicts:Conflict[]=[];
  const entries=new Map<string,HistoryEntry>();
  const extraHistory:HistoryEntry[]=[];
  // 1. Validate, scope to this request, and de-duplicate by id.
  for(const raw of [...input].sort(byRecorded)){
    validateEvent(raw);
    if(raw.requestId!==requestId){
      conflicts.push({kind:"event_for_other_request",eventIds:[raw.id],message:"An event for another request was ignored."});
      continue;
    }
    const prior=entries.get(raw.id);
    if(prior){
      if(stable(prior.event)===stable(raw)){extraHistory.push({event:raw,state:"duplicate",effective:null,correctedBy:[]});continue;}
      conflicts.push({kind:"conflicting_duplicate_id",eventIds:[raw.id],message:"Two different events share one identifier; the first recorded is kept."});
      extraHistory.push({event:raw,state:"rejected",effective:null,correctedBy:[]});
      continue;
    }
    entries.set(raw.id,{event:raw,state:raw.type==="correction"?"correction":"applied",effective:raw.type==="correction"?null:raw,correctedBy:[]});
  }
  // 2. Corrections, applied in recorded order: the latest valid one wins.
  const corrections=[...entries.values()].map(e=>e.event).filter(e=>e.type==="correction").sort(byRecorded);
  for(const c of corrections as LifecycleEvent<"correction">[]){
    const target=entries.get(c.correctsEventId!);
    const self=entries.get(c.id)!;
    if(!target){self.state="awaiting_cause";continue;}
    if(target.event.type==="correction"){
      self.state="rejected";
      conflicts.push({kind:"invalid_correction",eventIds:[c.id],message:"Correct the original event, not another correction."});
      continue;
    }
    if(rank[c.verification]<rank[target.event.verification]){
      self.state="rejected";
      conflicts.push({kind:"insufficient_correction_authority",eventIds:[c.id,target.event.id],
        message:"A correction needs at least the evidence level of the event it changes."});
      continue;
    }
    target.correctedBy.push(c.id);
    if(c.payload.retract){target.effective=null;target.state="retracted";continue;}
    const replacement:LifecycleEvent={...target.event,
      occurredOn:c.payload.replacement?.occurredOn??target.event.occurredOn,
      payload:(c.payload.replacement?.payload??target.event.payload) as LifecyclePayloads[typeof target.event.type],
      verification:c.verification,assertedBy:c.assertedBy,evidenceRef:c.evidenceRef??target.event.evidenceRef};
    try{validatePayload(replacement.type,replacement.payload);}
    catch{
      self.state="rejected";target.correctedBy.pop();
      conflicts.push({kind:"invalid_correction",eventIds:[c.id],message:"A correction contained invalid values and was not applied."});
      continue;
    }
    target.effective=replacement;target.state="corrected";
  }
  // 3. Causal references: an event whose cause has not arrived waits.
  let changed=true;
  while(changed){
    changed=false;
    for(const entry of entries.values()){
      const cause=entry.event.causedBy;
      if(!entry.effective || !cause)continue;
      const c=entries.get(cause);
      if(!c || !c.effective){entry.effective=null;entry.state="awaiting_cause";changed=true;}
    }
  }
  const effective=[...entries.values()].map(e=>e.effective).filter((e):e is LifecycleEvent=>!!e).sort(order);
  const byId=new Map(effective.map(e=>[e.id,e]));
  for(const e of effective){
    const cause=e.causedBy?byId.get(e.causedBy):null;
    if(cause && e.occurredOn<cause.occurredOn)
      conflicts.push({kind:"occurs_before_cause",eventIds:[cause.id,e.id],message:"An event is dated before the event it responds to."});
  }

  // 4. Fold effective events into facts.
  const facts:LifecycleFacts={filedOn:null,receivedOn:null,receiptVerification:null,agencyTrackingNumber:null,tolls:[],extensions:[],
    expedited:null,determination:null,appeal:null,interimReleases:0};
  const filings=effective.filter(e=>e.type==="filed");
  if(filings.length){
    facts.filedOn=filings[0].occurredOn;
    if(new Set(filings.map(f=>f.occurredOn)).size>1)
      conflicts.push({kind:"competing_filing_dates",eventIds:filings.map(f=>f.id),message:"Different filing dates are recorded."});
  }
  const openTolls=new Map<string,ClockToll>();
  let determinationOpen=false;
  for(const e of effective){
    if(facts.filedOn && e.occurredOn<facts.filedOn && !["adopted","drafted","filed"].includes(e.type))
      conflicts.push({kind:"precedes_filing",eventIds:[e.id],message:"An agency event is dated before the filing date."});
    switch(e.type){
      case "receipt_confirmed": case "acknowledged":{
        const better=facts.receivedOn===null || rank[e.verification]>rank[facts.receiptVerification!] ||
          (rank[e.verification]===rank[facts.receiptVerification!] && e.occurredOn<facts.receivedOn);
        if(better){facts.receivedOn=e.occurredOn;facts.receiptVerification=e.verification;}
        const tn=(e.payload as LifecyclePayloads["acknowledged"]).agencyTrackingNumber;
        if(e.type==="acknowledged" && tn)facts.agencyTrackingNumber=tn;
        break;
      }
      case "clarification_requested": case "fee_estimate_received":{
        const t:ClockToll={kind:e.type==="fee_estimate_received"?"fee":"information",requestedOn:e.occurredOn,resolvedOn:null};
        facts.tolls.push(t);openTolls.set(e.id,t);break;
      }
      case "clarification_answered": case "fee_response_sent":{
        const kind=e.type==="fee_response_sent"?"fee":"information";
        let target=e.causedBy?openTolls.get(e.causedBy):undefined;
        if(!target)target=[...openTolls.values()].find(t=>t.kind===kind && t.resolvedOn===null && t.requestedOn<=e.occurredOn);
        if(target && target.kind===kind && target.resolvedOn===null)target.resolvedOn=e.occurredOn;
        break;
      }
      case "extension_notice":{
        const p=e.payload as LifecyclePayloads["extension_notice"];
        facts.extensions.push({kind:"unusual_circumstances",noticeOn:e.occurredOn,workingDays:p.workingDays,writtenNotice:p.writtenNotice});
        break;
      }
      case "alternative_timeframe_agreed":
        facts.extensions.push({kind:"alternative_timeframe",agreedOn:(e.payload as LifecyclePayloads["alternative_timeframe_agreed"]).agreedOn});
        break;
      case "expedite_requested":facts.expedited={requestedOn:e.occurredOn,decidedOn:null,granted:null};break;
      case "expedite_decided":
        if(facts.expedited){facts.expedited.decidedOn=e.occurredOn;facts.expedited.granted=(e.payload as LifecyclePayloads["expedite_decided"]).granted;}
        break;
      case "interim_release":facts.interimReleases++;break;
      case "final_determination":{
        const p=e.payload as LifecyclePayloads["final_determination"];
        if(determinationOpen && facts.determination && facts.determination.outcome!==p.outcome)
          conflicts.push({kind:"competing_determinations",eventIds:[facts.determination.eventId,e.id],
            message:"Two different determinations are recorded without an appeal decision or reopening between them."});
        facts.determination={on:e.occurredOn,outcome:p.outcome,statedAppealDeadline:p.statedAppealDeadline??null,eventId:e.id};
        determinationOpen=true;facts.appeal=null;break;
      }
      case "appeal_filed":
        if(!facts.determination || !adverse(facts.determination.outcome))
          conflicts.push({kind:"appeal_without_adverse_determination",eventIds:[e.id],message:"An appeal is recorded without a recorded adverse determination."});
        facts.appeal={filedOn:e.occurredOn,receivedOn:null,decidedOn:null};break;
      case "appeal_received":if(facts.appeal)facts.appeal.receivedOn=e.occurredOn;break;
      case "appeal_determination":if(facts.appeal)facts.appeal.decidedOn=e.occurredOn;determinationOpen=false;break;
      case "reopened":determinationOpen=false;break;
      default:break;
    }
  }
  const disputed=conflicts.some(c=>["competing_filing_dates","competing_determinations","conflicting_duplicate_id","precedes_filing","occurs_before_cause"].includes(c.kind));

  // 5. Current status = last stage-bearing effective event.
  let status:StatusView|null=null;
  const last=[...effective].reverse().find(e=>stageOf[e.type]);
  if(last){
    const stage=stageOf[last.type]!;
    let label=stageWords[stage];
    if(last.type==="final_determination")label+=": "+(last.payload as LifecyclePayloads["final_determination"]).outcome.replace(/_/g," ");
    status={stage,label:`${label} (${verificationWords(last.verification,last.assertedBy)})${disputed?" — records conflict, under review":""}`,
      assertedBy:last.assertedBy,verification:last.verification,observedOn:last.occurredOn,recordedAt:last.recordedAt,
      basisEventId:last.id,disputed};
  }
  const history=[...entries.values(),...extraHistory].sort((a,b)=>byRecorded(a.event,b.event));
  return {requestId,status,history,conflicts,facts,disputed};
}

/** Clock inputs derived from evidence. Only reviewer-verified receipt counts as agency evidence. */
export function clockInputFromProjection(p:LifecycleProjection,today:IsoDate):ClockInput {
  const f=p.facts;
  let receiptBasis:ReceiptBasis|null=null;
  if(f.receivedOn)receiptBasis=f.receiptVerification==="reviewer_verified"?"agency_acknowledgment":"requester_estimate";
  return {
    today,
    filedOn:f.filedOn && f.filedOn<=today?f.filedOn:null,
    receivedOn:f.receivedOn,
    receiptBasis,
    tolls:f.tolls,
    extensions:f.extensions,
    expedited:f.expedited?{requestedOn:f.expedited.requestedOn,decidedOn:f.expedited.decidedOn}:null,
    determination:f.determination?{on:f.determination.on,adverse:adverse(f.determination.outcome),
      statedAppealDeadline:f.determination.statedAppealDeadline}:null,
    appeal:f.appeal,
    disputed:p.disputed
  };
}

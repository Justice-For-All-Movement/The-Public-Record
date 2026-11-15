/**
 * TPR-23 — Typed, append-only request lifecycle events.
 *
 * Events are never edited. A mistake is fixed by a `correction` event that
 * supersedes (or retracts) an earlier one; both stay in the history.
 * `assertedBy` + `verification` record who says something happened and how it
 * is evidenced. A requester can never create a reviewer-verified event.
 */
import {isValidIsoDate,type IsoDate} from "../clock/federal-calendar";

export const lifecycleEventTypes = [
  "adopted","drafted","filed","receipt_confirmed","acknowledged",
  "clarification_requested","clarification_answered","fee_estimate_received","fee_response_sent",
  "extension_notice","alternative_timeframe_agreed","expedite_requested","expedite_decided",
  "referral","interim_release","final_determination",
  "appeal_filed","appeal_received","appeal_determination",
  "closed","reopened","withdrawn","correction"
] as const;
export type LifecycleEventType = typeof lifecycleEventTypes[number];
export type AssertedBy = "requester"|"agency_document"|"reviewer";
export type Verification = "self_reported"|"document_attached"|"reviewer_verified";
export type DeterminationOutcome = "full_grant"|"partial_grant"|"full_denial"|"no_records"|"fee_related"|"other_adverse"|"withdrawn_by_agency";
export type AppealOutcome = "affirmed"|"reversed"|"remanded"|"partly_reversed"|"closed_other";

export interface LifecyclePayloads {
  adopted:{templateId?:string;templateVersion?:number};
  drafted:Record<string,never>;
  filed:{channel:"portal"|"email"|"mail"|"fax"|"other"};
  receipt_confirmed:Record<string,never>;
  acknowledged:{agencyTrackingNumber?:string};
  clarification_requested:Record<string,never>;
  clarification_answered:Record<string,never>;
  fee_estimate_received:{amountUsd?:number};
  /** acceptedMaxUsd: the most the participant explicitly agreed to pay. */
  fee_response_sent:{decision:"accepted"|"narrowed"|"declined"|"waiver_requested";acceptedMaxUsd?:number};
  extension_notice:{workingDays:number;writtenNotice:boolean};
  alternative_timeframe_agreed:{agreedOn:IsoDate|null};
  expedite_requested:Record<string,never>;
  expedite_decided:{granted:boolean};
  referral:{toAgency?:string};
  interim_release:{pages?:number};
  final_determination:{outcome:DeterminationOutcome;statedAppealDeadline?:IsoDate|null;pages?:number};
  appeal_filed:Record<string,never>;
  appeal_received:Record<string,never>;
  appeal_determination:{outcome:AppealOutcome};
  closed:Record<string,never>;
  reopened:Record<string,never>;
  withdrawn:Record<string,never>;
  correction:{reason:string;retract:boolean;replacement?:{occurredOn?:IsoDate;payload?:Record<string,unknown>}};
}
export interface LifecycleEvent<T extends LifecycleEventType=LifecycleEventType> {
  id:string;
  requestId:string;
  type:T;
  /** Date the event happened according to its evidence (not when recorded). */
  occurredOn:IsoDate;
  /** Server receipt time (ISO 8601). Ordering tiebreaker only. */
  recordedAt:string;
  assertedBy:AssertedBy;
  verification:Verification;
  evidenceRef:string|null;
  /** The event this one responds to (e.g. an answer to a clarification). */
  causedBy:string|null;
  /** Target of a correction. */
  correctsEventId:string|null;
  payload:LifecyclePayloads[T];
}

export class LifecycleEventError extends Error {
  constructor(message:string){super(message);this.name="LifecycleEventError";}
}
const idRe=/^[A-Za-z0-9_-]{3,128}$/;
const evidenceRe=/^[A-Za-z0-9:_.-]{1,160}$/;
const isObj=(v:unknown):v is Record<string,unknown>=>!!v && typeof v==="object" && !Array.isArray(v);
const outcomes:DeterminationOutcome[]=["full_grant","partial_grant","full_denial","no_records","fee_related","other_adverse","withdrawn_by_agency"];
const appealOutcomes:AppealOutcome[]=["affirmed","reversed","remanded","partly_reversed","closed_other"];
const onlyKeys=(o:Record<string,unknown>,keys:string[])=>Object.keys(o).every(k=>keys.includes(k));
const optInt=(v:unknown,max:number)=>v===undefined || (Number.isSafeInteger(v) && (v as number)>=0 && (v as number)<=max);

/** Validates a payload for its event type. Unknown keys are rejected (no free-form PII bags). */
export function validatePayload(type:LifecycleEventType,payload:unknown):void {
  if(!isObj(payload) || JSON.stringify(payload).length>2048)throw new LifecycleEventError("Invalid payload");
  const p=payload;
  const ok=(():boolean=>{
    switch(type){
      case "adopted":return onlyKeys(p,["templateId","templateVersion"]) &&
        (p.templateId===undefined || (typeof p.templateId==="string" && idRe.test(p.templateId))) && optInt(p.templateVersion,100000);
      case "filed":return onlyKeys(p,["channel"]) && ["portal","email","mail","fax","other"].includes(p.channel as string);
      case "acknowledged":return onlyKeys(p,["agencyTrackingNumber"]) &&
        (p.agencyTrackingNumber===undefined || (typeof p.agencyTrackingNumber==="string" && /^[A-Za-z0-9 ._/-]{1,64}$/.test(p.agencyTrackingNumber)));
      case "fee_estimate_received":return onlyKeys(p,["amountUsd"]) &&
        (p.amountUsd===undefined || (typeof p.amountUsd==="number" && Number.isFinite(p.amountUsd) && p.amountUsd>=0 && p.amountUsd<=1e7));
      case "fee_response_sent":return onlyKeys(p,["decision","acceptedMaxUsd"]) && ["accepted","narrowed","declined","waiver_requested"].includes(p.decision as string) &&
        (p.acceptedMaxUsd===undefined || (p.decision==="accepted" && typeof p.acceptedMaxUsd==="number" && Number.isFinite(p.acceptedMaxUsd) &&
          p.acceptedMaxUsd>=0 && p.acceptedMaxUsd<=1e7));
      case "extension_notice":return onlyKeys(p,["workingDays","writtenNotice"]) && Number.isSafeInteger(p.workingDays) &&
        (p.workingDays as number)>=1 && (p.workingDays as number)<=60 && typeof p.writtenNotice==="boolean";
      case "alternative_timeframe_agreed":return onlyKeys(p,["agreedOn"]) && (p.agreedOn===null || isValidIsoDate(p.agreedOn));
      case "expedite_decided":return onlyKeys(p,["granted"]) && typeof p.granted==="boolean";
      case "referral":return onlyKeys(p,["toAgency"]) && (p.toAgency===undefined || (typeof p.toAgency==="string" && p.toAgency.length<=200));
      case "interim_release":return onlyKeys(p,["pages"]) && optInt(p.pages,1e7);
      case "final_determination":return onlyKeys(p,["outcome","statedAppealDeadline","pages"]) && outcomes.includes(p.outcome as DeterminationOutcome) &&
        (p.statedAppealDeadline===undefined || p.statedAppealDeadline===null || isValidIsoDate(p.statedAppealDeadline)) && optInt(p.pages,1e7);
      case "appeal_determination":return onlyKeys(p,["outcome"]) && appealOutcomes.includes(p.outcome as AppealOutcome);
      case "correction":{
        if(!onlyKeys(p,["reason","retract","replacement"]) || typeof p.reason!=="string" || !p.reason.trim() ||
          p.reason.length>500 || typeof p.retract!=="boolean")return false;
        if(p.replacement===undefined)return p.retract;
        if(!isObj(p.replacement) || !onlyKeys(p.replacement,["occurredOn","payload"]) || p.retract)return false;
        if(p.replacement.occurredOn!==undefined && !isValidIsoDate(p.replacement.occurredOn))return false;
        return p.replacement.payload===undefined || isObj(p.replacement.payload);
      }
      default:return Object.keys(p).length===0;
    }
  })();
  if(!ok)throw new LifecycleEventError("Invalid payload for "+type);
}

export function validateEvent(e:LifecycleEvent):void {
  if(!isObj(e) || !idRe.test(e.id) || !idRe.test(e.requestId) ||
     !(lifecycleEventTypes as readonly string[]).includes(e.type) || !isValidIsoDate(e.occurredOn) ||
     typeof e.recordedAt!=="string" || !/^\d{4}-\d{2}-\d{2}T/.test(e.recordedAt) || !Number.isFinite(Date.parse(e.recordedAt)) ||
     !["requester","agency_document","reviewer"].includes(e.assertedBy) ||
     !["self_reported","document_attached","reviewer_verified"].includes(e.verification) ||
     (e.evidenceRef!==null && !(typeof e.evidenceRef==="string" && evidenceRe.test(e.evidenceRef))) ||
     (e.causedBy!==null && !(typeof e.causedBy==="string" && idRe.test(e.causedBy))) ||
     (e.correctsEventId!==null && !(typeof e.correctsEventId==="string" && idRe.test(e.correctsEventId))) ||
     ((e.type==="correction")!==(e.correctsEventId!==null)) || e.causedBy===e.id || e.correctsEventId===e.id)
    throw new LifecycleEventError("Invalid lifecycle event");
  // Evidence levels must be internally consistent.
  if(e.verification==="document_attached" && !e.evidenceRef)throw new LifecycleEventError("Attached-document events need an evidence reference");
  if(e.verification==="reviewer_verified" && (e.assertedBy!=="reviewer" || !e.evidenceRef))
    throw new LifecycleEventError("Only a reviewer with evidence can verify an event");
  if(e.assertedBy==="agency_document" && e.verification==="self_reported")
    throw new LifecycleEventError("Agency-document events must reference the document");
  validatePayload(e.type,e.payload);
}

/** Events a participant may record directly (no reviewer verification). */
export function assertParticipantMayRecord(e:Pick<LifecycleEvent,"assertedBy"|"verification">):void {
  if(e.assertedBy==="reviewer" || e.verification==="reviewer_verified")
    throw new LifecycleEventError("Participants cannot record reviewer-verified events");
}

/** Key-order-independent JSON for equality checks (jsonb reorders keys). */
export function canonicalJson(value:unknown):string {
  if(Array.isArray(value))return "["+value.map(canonicalJson).join(",")+"]";
  if(value && typeof value==="object")
    return "{"+Object.keys(value).sort().filter(k=>(value as Record<string,unknown>)[k]!==undefined)
      .map(k=>JSON.stringify(k)+":"+canonicalJson((value as Record<string,unknown>)[k])).join(",")+"}";
  return JSON.stringify(value);
}

import {randomBytes} from "node:crypto";
import type {PoolClient} from "pg";
import {isValidIsoDate} from "../clock/federal-calendar";
import {recordAudit} from "../audit/audit-log";
import type {CatalogTemplate} from "../adoption/templates";
import {pinReviewedTemplate} from "../adoption/templates";
import {LifecycleEventError,canonicalJson,validateEvent,type LifecycleEvent} from "../lifecycle/events";
import {appendParticipantEvent,listLifecycleEvents,type NewLifecycleEvent} from "../lifecycle/repository";
import {withSubject} from "./db";
import {clockInputFromProjection,rebuildLifecycle} from "../lifecycle/projection";
import {computeFoiaClock} from "../clock/foia-clock";
import {createFederalCalendar} from "../clock/federal-calendar";
import {scheduleReminders} from "../jobs/reminders";
const reminderCalendar=createFederalCalendar();
import type {AuthSession,MemberStore} from "./member-store";

export interface DraftRecord {
  id:string;title:string;body:string;templateId:string|null;templateVersion:number|null;
  agencyLabel:string|null;agencyComponentRef:string|null;rangeStart:string|null;rangeEnd:string|null;
  feeCapUsd:number;electronicCopies:boolean;version:number;createdAt:string;updatedAt:string;
}
export interface DraftPatch {
  title?:string;body?:string;rangeStart?:string|null;rangeEnd?:string|null;feeCapUsd?:number;electronicCopies?:boolean;
}
export type UpdateResult = {status:"ok";draft:DraftRecord}|{status:"not_found"}|{status:"conflict";current:DraftRecord};
export interface DraftStore {
  list(s:AuthSession):Promise<DraftRecord[]>;
  get(s:AuthSession,id:string):Promise<DraftRecord|null>;
  create(s:AuthSession,template:CatalogTemplate|null,idempotencyKey:string|null):Promise<{draft:DraftRecord;replayed:boolean}>;
  update(s:AuthSession,id:string,expectedVersion:number,patch:DraftPatch):Promise<UpdateResult>;
  listEvents(s:AuthSession,id:string):Promise<LifecycleEvent[]|null>;
  appendEvent(s:AuthSession,id:string,input:NewLifecycleEvent,key:string|null):Promise<{event:LifecycleEvent;replayed:boolean}|null>;
}
export class DraftValidationError extends Error {constructor(m:string){super(m);this.name="DraftValidationError";}}

const draftId=/^drf_[A-Za-z0-9_-]{16,40}$/;
export function isDraftId(v:unknown):v is string {return typeof v==="string" && draftId.test(v);}
const patchKeys=["title","body","rangeStart","rangeEnd","feeCapUsd","electronicCopies"];
/** Strict validation: unknown keys and out-of-range values are rejected. */
export function validateDraftPatch(input:unknown):DraftPatch {
  if(!input || typeof input!=="object" || Array.isArray(input))throw new DraftValidationError("Expected an object");
  const p=input as Record<string,unknown>;
  for(const k of Object.keys(p))if(!patchKeys.includes(k))throw new DraftValidationError("Unknown field: "+k);
  const out:DraftPatch={};
  if(p.title!==undefined){if(typeof p.title!=="string" || p.title.length>250)throw new DraftValidationError("Title too long");out.title=p.title;}
  if(p.body!==undefined){if(typeof p.body!=="string" || p.body.length>20000)throw new DraftValidationError("Request text too long");out.body=p.body;}
  for(const k of ["rangeStart","rangeEnd"] as const){
    if(p[k]===undefined)continue;
    if(p[k]!==null && !isValidIsoDate(p[k]))throw new DraftValidationError("Invalid date");
    out[k]=p[k] as string|null;
  }
  if(p.feeCapUsd!==undefined){
    if(typeof p.feeCapUsd!=="number" || !Number.isFinite(p.feeCapUsd) || p.feeCapUsd<0 || p.feeCapUsd>10000 ||
       Math.round(p.feeCapUsd*100)!==p.feeCapUsd*100)throw new DraftValidationError("Fee cap must be 0–10000 USD");
    out.feeCapUsd=p.feeCapUsd;
  }
  if(p.electronicCopies!==undefined){if(typeof p.electronicCopies!=="boolean")throw new DraftValidationError("Invalid preference");out.electronicCopies=p.electronicCopies;}
  return out;
}
function checkRange(d:Pick<DraftRecord,"rangeStart"|"rangeEnd">){
  if(d.rangeStart && d.rangeEnd && d.rangeStart>d.rangeEnd)throw new DraftValidationError("Start date is after end date");
}
const newId=()=>"drf_"+randomBytes(16).toString("base64url");
function initial(template:CatalogTemplate|null,subject:string){
  if(!template)return {title:"Untitled request",body:"",templateId:null,templateVersion:null,agencyLabel:null,agencyComponentRef:null,rangeStart:null,rangeEnd:null};
  // Copies the reviewed text: later template revisions never change this draft.
  const pinned=pinReviewedTemplate(template,subject);
  return {title:pinned.title,body:pinned.recordsDescription,templateId:pinned.templateId,templateVersion:pinned.templateVersion,
    agencyLabel:template.agencyLabel,agencyComponentRef:pinned.agencyComponentId,rangeStart:pinned.rangeStart,rangeEnd:pinned.rangeEnd};
}
const today=()=>new Date().toISOString().slice(0,10);
function creationEvent(template:CatalogTemplate|null):NewLifecycleEvent {
  return template
    ? {type:"adopted",occurredOn:today(),assertedBy:"requester",verification:"self_reported",evidenceRef:null,causedBy:null,correctsEventId:null,
        payload:{templateId:template.templateId,templateVersion:template.version}}
    : {type:"drafted",occurredOn:today(),assertedBy:"requester",verification:"self_reported",evidenceRef:null,causedBy:null,correctsEventId:null,payload:{}};
}

interface Row {
  id:string;title:string;draft_body:string;template_id:string|null;template_version:number|null;agency_label:string|null;
  agency_component_ref:string|null;range_start:string|null;range_end:string|null;fee_cap_usd:string;electronic_copies:boolean;
  version:number;created_at:Date;updated_at:Date;
}
const cols=`id,title,draft_body,template_id,template_version,agency_label,agency_component_ref,
  to_char(range_start,'YYYY-MM-DD') AS range_start,to_char(range_end,'YYYY-MM-DD') AS range_end,
  fee_cap_usd,electronic_copies,version,created_at,updated_at`;
const fromRow=(r:Row):DraftRecord=>({id:r.id,title:r.title,body:r.draft_body,templateId:r.template_id,templateVersion:r.template_version,
  agencyLabel:r.agency_label,agencyComponentRef:r.agency_component_ref,rangeStart:r.range_start,rangeEnd:r.range_end,
  feeCapUsd:Number(r.fee_cap_usd),electronicCopies:r.electronic_copies,version:r.version,
  createdAt:r.created_at.toISOString(),updatedAt:r.updated_at.toISOString()});

export function createPostgresDraftStore():DraftStore {
  const get=async(db:PoolClient,id:string)=>{
    const r=await db.query<Row>(`SELECT ${cols} FROM tpr_private.request_drafts WHERE id=$1`,[id]);
    return r.rows[0]?fromRow(r.rows[0]):null;
  };
  return {
    list:s=>withSubject(s,async db=>(await db.query<Row>(`SELECT ${cols} FROM tpr_private.request_drafts
      ORDER BY updated_at DESC,id LIMIT 200`)).rows.map(fromRow)),
    get:(s,id)=>isDraftId(id)?withSubject(s,db=>get(db,id)):Promise.resolve(null),
    create:(s,template,key)=>withSubject(s,async db=>{
      const v=initial(template,s.subject);
      const r=await db.query<Row>(`INSERT INTO tpr_private.request_drafts
        (id,owner_subject,title,draft_body,template_id,template_version,agency_label,agency_component_ref,range_start,range_end,state,idempotency_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11)
        ON CONFLICT (owner_subject,idempotency_key) DO NOTHING RETURNING ${cols}`,
        [newId(),s.subject,v.title,v.body,v.templateId,v.templateVersion,v.agencyLabel,v.agencyComponentRef,v.rangeStart,v.rangeEnd,key]);
      if(!r.rows[0]){
        const prior=await db.query<Row>(`SELECT ${cols} FROM tpr_private.request_drafts WHERE owner_subject=$1 AND idempotency_key=$2`,[s.subject,key]);
        const draft=fromRow(prior.rows[0]);
        if(draft.templateId!==v.templateId)throw new DraftValidationError("Idempotency key reused for a different draft");
        return {draft,replayed:true};
      }
      const draft=fromRow(r.rows[0]);
      const ev=await appendParticipantEvent(db,s.subject,draft.id,creationEvent(template),null);
      await recordAudit(db,{owner:s.subject,actor:s.subject,action:template?"draft_adopted":"draft_created",objectKind:"request_draft",objectId:draft.id});
      await recordAudit(db,{owner:s.subject,actor:s.subject,action:"lifecycle_event_recorded",objectKind:"lifecycle_event",objectId:ev.event.id});
      return {draft,replayed:false};
    }),
    update:(s,id,expected,patch)=>!isDraftId(id)?Promise.resolve({status:"not_found"}):withSubject(s,async db=>{
      const current=await get(db,id);
      if(!current)return {status:"not_found"} as const;
      if(current.version!==expected)return {status:"conflict",current} as const;
      const next={...current,...patch};
      checkRange(next);
      const r=await db.query<Row>(`UPDATE tpr_private.request_drafts SET title=$3,draft_body=$4,range_start=$5,range_end=$6,
        fee_cap_usd=$7,electronic_copies=$8,version=version+1,updated_at=now()
        WHERE id=$1 AND version=$2 RETURNING ${cols}`,
        [id,expected,next.title,next.body,next.rangeStart,next.rangeEnd,next.feeCapUsd,next.electronicCopies]);
      if(!r.rows[0])return {status:"conflict",current:(await get(db,id))!} as const;
      await recordAudit(db,{owner:s.subject,actor:s.subject,action:"draft_updated",objectKind:"request_draft",objectId:id});
      return {status:"ok",draft:fromRow(r.rows[0])} as const;
    }),
    listEvents:(s,id)=>!isDraftId(id)?Promise.resolve(null):withSubject(s,async db=>(await get(db,id))?listLifecycleEvents(db,id):null),
    appendEvent:(s,id,input,key)=>!isDraftId(id)?Promise.resolve(null):withSubject(s,async db=>{
      if(!(await get(db,id)))return null;
      const res=await appendParticipantEvent(db,s.subject,id,input,key);
      if(!res.replayed){
        await recordAudit(db,{owner:s.subject,actor:s.subject,action:"lifecycle_event_recorded",objectKind:"lifecycle_event",objectId:res.event.id});
        // TPR-25: schedule private reminders from the rebuilt estimate, in the same transaction.
        const now=today();
        const projection=rebuildLifecycle(id,await listLifecycleEvents(db,id));
        await scheduleReminders(db,s.subject,id,computeFoiaClock(clockInputFromProjection(projection,now),reminderCalendar),now);
      }
      return res;
    })
  };
}

/** Synthetic-preview store (no database). Same validation; data resets on restart. */
interface MemDrafts {drafts:Map<string,Map<string,DraftRecord&{key:string|null}>>;events:Map<string,(LifecycleEvent&{key:string|null})[]>}
const holder=globalThis as typeof globalThis & {__tprMemDrafts?:MemDrafts};
function mem():MemDrafts {
  if(!holder.__tprMemDrafts)holder.__tprMemDrafts={drafts:new Map(),events:new Map()};
  return holder.__tprMemDrafts;
}
export function createMemoryDraftStore(members:MemberStore):DraftStore {
  const m=mem();
  const mine=(s:AuthSession)=>{let d=m.drafts.get(s.subject);if(!d){d=new Map();m.drafts.set(s.subject,d);}return d;};
  const strip=<T extends {key:string|null}>(x:T)=>{const {key:_k,...rest}=x;void _k;return rest;};
  const append=async(s:AuthSession,id:string,input:NewLifecycleEvent,key:string|null)=>{
    if(input.assertedBy==="reviewer"||input.verification==="reviewer_verified")throw new LifecycleEventError("Participants cannot record reviewer-verified events");
    const list=m.events.get(id)??[];
    if(key){
      const prior=list.find(e=>e.key===key);
      if(prior){
        if(prior.type!==input.type||prior.occurredOn!==input.occurredOn||canonicalJson(prior.payload)!==canonicalJson(input.payload))
          throw new LifecycleEventError("Idempotency key reused for a different event");
        return {event:strip(prior) as LifecycleEvent,replayed:true};
      }
    }
    if(input.causedBy && !list.some(e=>e.id===input.causedBy))throw new LifecycleEventError("Unknown cause");
    if(input.correctsEventId && !list.some(e=>e.id===input.correctsEventId))throw new LifecycleEventError("Unknown corrected event");
    const event={...input,id:randomBytes(16).toString("hex"),requestId:id,recordedAt:new Date().toISOString()} as LifecycleEvent;
    validateEvent(event);
    list.push({...event,key});m.events.set(id,list);
    await members.transaction(s,tx=>tx.audit({action:"lifecycle_event_recorded",objectKind:"lifecycle_event",objectId:event.id}));
    return {event,replayed:false};
  };
  return {
    async list(s){return [...mine(s).values()].map(strip).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));},
    async get(s,id){const d=mine(s).get(id);return d?strip(d):null;},
    async create(s,template,key){
      const d=mine(s);
      const prior=key?[...d.values()].find(x=>x.key===key):undefined;
      if(prior)return {draft:strip(prior),replayed:true};
      const now=new Date().toISOString();
      const draft={id:newId(),...initial(template,s.subject),feeCapUsd:25,electronicCopies:true,version:1,createdAt:now,updatedAt:now};
      d.set(draft.id,{...draft,key});
      await append(s,draft.id,creationEvent(template),null);
      await members.transaction(s,tx=>tx.audit({action:template?"draft_adopted":"draft_created",objectKind:"request_draft",objectId:draft.id}));
      return {draft,replayed:false};
    },
    async update(s,id,expected,patch){
      const cur=mine(s).get(id);
      if(!cur)return {status:"not_found"};
      if(cur.version!==expected)return {status:"conflict",current:strip(cur)};
      const next={...cur,...patch,version:cur.version+1,updatedAt:new Date().toISOString()};
      checkRange(next);
      mine(s).set(id,next);
      await members.transaction(s,tx=>tx.audit({action:"draft_updated",objectKind:"request_draft",objectId:id}));
      return {status:"ok",draft:strip(next)};
    },
    async listEvents(s,id){return mine(s).has(id)?(m.events.get(id)??[]).map(e=>strip(e) as LifecycleEvent):null;},
    async appendEvent(s,id,input,key){return mine(s).has(id)?append(s,id,input,key):null;}
  };
}
export function draftStoreFor(members:MemberStore):DraftStore {
  return members.kind==="postgres"?createPostgresDraftStore():createMemoryDraftStore(members);
}

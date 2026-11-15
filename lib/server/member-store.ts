import type {PoolClient} from "pg";
import {roles,type Role} from "../auth/authorization";
import {listOwnAudit,recordAudit,type AuditEntry,type AuditRecord} from "../audit/audit-log";
import {config} from "./config";
import {getPool,withSubject} from "./db";

export interface AuthSession {readonly id:string;readonly subject:string;readonly issuer:string;readonly expiresAt:number}

/**
 * Identity, session-revocation, role and audit persistence. The PostgreSQL
 * implementation runs every call under RLS for the verified subject. The
 * memory implementation exists only so a credential-free preview can be
 * demonstrated with synthetic identities; it is never used in production.
 */
export interface MemberStore {
  readonly kind:"postgres"|"memory";
  startSession(s:AuthSession):Promise<"active"|"locked">;
  isSessionActive(s:AuthSession):Promise<boolean>;
  endSession(s:AuthSession):Promise<void>;
  rolesFor(s:AuthSession):Promise<Role[]>;
  listAudit(s:AuthSession):Promise<AuditRecord[]>;
  /** Run owner-scoped work with an audit sink in the same transaction. */
  transaction<T>(s:AuthSession,fn:(tx:StoreTransaction)=>Promise<T>):Promise<T>;
}
export interface StoreTransaction {
  readonly db:PoolClient|null;
  audit(entry:Omit<AuditEntry,"owner"|"actor">):Promise<void>;
}

/** Every verified member may act as a requester for their own records. */
export const BASE_ROLE:Role="requester";
export function currentRolesFromGrants(rows:readonly {role:string;grant_action:string}[]):Role[] {
  // rows newest-first per role: the latest event decides.
  const seen=new Set<string>(), result=new Set<Role>([BASE_ROLE]);
  for(const r of rows){
    if(seen.has(r.role))continue;
    seen.add(r.role);
    if(r.grant_action==="granted" && (roles as readonly string[]).includes(r.role))result.add(r.role as Role);
  }
  return [...result].sort();
}

export function createPostgresStore():MemberStore {
  const tx=<T,>(s:AuthSession,fn:(db:PoolClient)=>Promise<T>)=>withSubject(s,fn);
  return {
    kind:"postgres",
    async startSession(s){
      return tx(s,async db=>{
        const existing=await db.query<{issuer:string;status:string}>(
          "SELECT issuer,status FROM tpr_private.member_accounts WHERE owner_subject=$1",[s.subject]);
        const row=existing.rows[0];
        if(row && (row.status!=="active" || row.issuer!==s.issuer))return "locked";
        if(row)await db.query("UPDATE tpr_private.member_accounts SET last_login_at=now() WHERE owner_subject=$1",[s.subject]);
        else await db.query("INSERT INTO tpr_private.member_accounts(owner_subject,issuer) VALUES($1,$2)",[s.subject,s.issuer]);
        await db.query("INSERT INTO tpr_private.app_sessions(id,owner_subject,issuer,expires_at) VALUES($1,$2,$3,to_timestamp($4))",
          [s.id,s.subject,s.issuer,s.expiresAt]);
        await recordAudit(db,{owner:s.subject,actor:s.subject,action:"session_started",objectKind:"session",objectId:s.id});
        return "active";
      });
    },
    async isSessionActive(s){
      return tx(s,async db=>{
        const r=await db.query(`SELECT 1 FROM tpr_private.app_sessions se
          JOIN tpr_private.member_accounts a ON a.owner_subject=se.owner_subject
          WHERE se.id=$1 AND se.owner_subject=$2 AND se.issuer=$3 AND a.issuer=$3 AND a.status='active'
            AND se.revoked_at IS NULL AND se.expires_at>now()`,[s.id,s.subject,s.issuer]);
        return r.rowCount===1;
      });
    },
    async endSession(s){
      await tx(s,async db=>{
        const r=await db.query("UPDATE tpr_private.app_sessions SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL",[s.id]);
        if(r.rowCount)await recordAudit(db,{owner:s.subject,actor:s.subject,action:"session_ended",objectKind:"session",objectId:s.id});
      });
    },
    async rolesFor(s){
      return tx(s,async db=>{
        const r=await db.query<{role:string;grant_action:string}>(`SELECT role,grant_action FROM tpr_private.role_grant_events
          WHERE owner_subject=$1 AND issuer=$2 ORDER BY role,recorded_at DESC,id DESC`,[s.subject,s.issuer]);
        return currentRolesFromGrants(r.rows);
      });
    },
    async listAudit(s){return tx(s,db=>listOwnAudit(db));},
    async transaction(s,fn){
      return tx(s,db=>fn({db,audit:e=>recordAudit(db,{...e,owner:s.subject,actor:s.subject})}));
    }
  };
}

interface MemoryState {
  accounts:Map<string,{issuer:string;status:"active"|"locked"}>;
  sessions:Map<string,{subject:string;issuer:string;expiresAt:number;revoked:boolean}>;
  audit:Map<string,AuditRecord[]>;
}
const holder=globalThis as typeof globalThis & {__tprMemoryState?:MemoryState};
export function memoryState():MemoryState {
  if(!holder.__tprMemoryState)holder.__tprMemoryState={accounts:new Map(),sessions:new Map(),audit:new Map()};
  return holder.__tprMemoryState;
}
export function createMemoryStore():MemberStore {
  const st=memoryState();
  const push=(s:AuthSession,e:Omit<AuditEntry,"owner"|"actor">)=>{
    const list=st.audit.get(s.subject)??[];
    list.unshift({action:e.action,objectKind:e.objectKind,objectId:e.objectId,occurredAt:new Date().toISOString(),byOwner:true});
    st.audit.set(s.subject,list.slice(0,500));
  };
  return {
    kind:"memory",
    async startSession(s){
      const a=st.accounts.get(s.subject);
      if(a && (a.status!=="active" || a.issuer!==s.issuer))return "locked";
      if(!a)st.accounts.set(s.subject,{issuer:s.issuer,status:"active"});
      st.sessions.set(s.id,{subject:s.subject,issuer:s.issuer,expiresAt:s.expiresAt,revoked:false});
      push(s,{action:"session_started",objectKind:"session",objectId:s.id});
      return "active";
    },
    async isSessionActive(s){
      const x=st.sessions.get(s.id);
      return !!x && !x.revoked && x.subject===s.subject && x.issuer===s.issuer && x.expiresAt>Date.now()/1000 &&
        st.accounts.get(s.subject)?.status==="active";
    },
    async endSession(s){
      const x=st.sessions.get(s.id);
      if(x && x.subject===s.subject && !x.revoked){x.revoked=true;push(s,{action:"session_ended",objectKind:"session",objectId:s.id});}
    },
    async rolesFor(){return [BASE_ROLE];},
    async listAudit(s){return [...(st.audit.get(s.subject)??[])];},
    async transaction(s,fn){return fn({db:null,audit:async e=>push(s,e)});}
  };
}

/** The store for this deployment, or null when private features are unavailable. */
export function memberStore():MemberStore|null {
  const cfg=config();
  if(getPool())return createPostgresStore();
  if(cfg.authMode==="fake" && cfg.stage!=="production" && cfg.stage!=="staging")return createMemoryStore();
  return null;
}

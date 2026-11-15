import {recordAudit} from "../audit/audit-log";
import {withSubject} from "./db";
import type {AuthSession,MemberStore} from "./member-store";

export interface MemberNotification {id:string;title:string;body:string;linkPath:string|null;createdAt:string;read:boolean}
export interface NotificationPreferences {deadlineReminders:boolean;available:boolean}

/** In-app notifications require PostgreSQL (the outbox worker); memory previews have none. */
export async function listNotifications(store:MemberStore,s:AuthSession):Promise<MemberNotification[]> {
  if(store.kind!=="postgres")return [];
  return withSubject(s,async db=>(await db.query<{id:string;title:string;body:string;link_path:string|null;created_at:Date;read_at:Date|null}>(
    `SELECT id::text,title,body,link_path,created_at,read_at FROM tpr_private.member_notifications ORDER BY created_at DESC LIMIT 50`)).rows
    .map(r=>({id:r.id,title:r.title,body:r.body,linkPath:r.link_path,createdAt:r.created_at.toISOString(),read:!!r.read_at})));
}
export async function getPreferences(store:MemberStore,s:AuthSession):Promise<NotificationPreferences> {
  if(store.kind!=="postgres")return {deadlineReminders:false,available:false};
  return withSubject(s,async db=>{
    const r=await db.query<{deadline_reminders:boolean}>("SELECT deadline_reminders FROM tpr_private.notification_preferences WHERE owner_subject=$1",[s.subject]);
    return {deadlineReminders:r.rows[0]?.deadline_reminders??true,available:true};
  });
}
export async function setPreferences(store:MemberStore,s:AuthSession,deadlineReminders:boolean):Promise<NotificationPreferences> {
  if(store.kind!=="postgres")return {deadlineReminders:false,available:false};
  return withSubject(s,async db=>{
    await db.query(`INSERT INTO tpr_private.notification_preferences(owner_subject,deadline_reminders) VALUES($1,$2)
      ON CONFLICT (owner_subject) DO UPDATE SET deadline_reminders=EXCLUDED.deadline_reminders,updated_at=now()`,[s.subject,deadlineReminders]);
    await recordAudit(db,{owner:s.subject,actor:s.subject,action:"notification_preference_changed",objectKind:"notification_preference",objectId:"deadline_reminders"});
    return {deadlineReminders,available:true};
  });
}
export async function markRead(store:MemberStore,s:AuthSession,id:string):Promise<boolean> {
  if(store.kind!=="postgres" || !/^[0-9a-f-]{36}$/.test(id))return false;
  return withSubject(s,async db=>(await db.query("UPDATE tpr_private.member_notifications SET read_at=now() WHERE id=$1 AND read_at IS NULL",[id])).rowCount===1);
}

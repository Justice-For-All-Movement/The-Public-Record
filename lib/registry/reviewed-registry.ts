/**
 * TPR-12/17 — persisted reviewed templates and filing routes (tpr_public).
 * All writes run in the actor's own RLS transaction under tpr_app_runtime and
 * are audited; authorization (authorize()) is checked by the caller and
 * independence (author ≠ reviewer) is enforced again by database CHECKs.
 */
import type {PoolClient} from "pg";
import {recordAudit} from "../audit/audit-log";
import {validateRequestTemplate,type RequestTemplate} from "../templates/versioned-requests";
import {evaluateFilingRoute,type ReviewedFilingRoute} from "../filing/verified-channel";
import type {FilingRegistry,RouteWithInstructions} from "../filing/self-filing-guide";
import type {CatalogTemplate} from "../adoption/templates";

export class RegistryError extends Error {constructor(m:string,readonly status:number=422){super(m);this.name="RegistryError";}}
type Db=Pick<PoolClient,"query">;

interface TemplateRow {
  template_id:string;version:number;title:string;agency_component_id:string;agency_label:string;records_description:string;
  range_start:string|null;range_end:string|null;source_ids:string[];state:CatalogTemplate["state"]|"rejected";
  editor_subject:string;reviewer_subject:string|null;review_note:string|null;created_at:Date;reviewed_at:Date|null;
}
export interface TemplateVersion extends Omit<CatalogTemplate,"state"> {
  state:CatalogTemplate["state"]|"rejected";reviewNote:string|null;createdAt:string;reviewedAt:string|null;
}
const tcols=`template_id,version,title,agency_component_id,agency_label,records_description,
  to_char(range_start,'YYYY-MM-DD') AS range_start,to_char(range_end,'YYYY-MM-DD') AS range_end,source_ids,state,
  editor_subject,reviewer_subject,review_note,created_at,reviewed_at`;
const toVersion=(r:TemplateRow):TemplateVersion=>({templateId:r.template_id,version:r.version,title:r.title,
  agencyComponentId:r.agency_component_id,agencyLabel:r.agency_label,recordsDescription:r.records_description,
  rangeStart:r.range_start,rangeEnd:r.range_end,sourceIds:r.source_ids,state:r.state,editorId:r.editor_subject,
  reviewerId:r.reviewer_subject,reviewNote:r.review_note,createdAt:r.created_at.toISOString(),reviewedAt:r.reviewed_at?.toISOString()??null});

export interface TemplateInput {
  title:string;agencyComponentId:string;agencyLabel:string;recordsDescription:string;
  rangeStart:string|null;rangeEnd:string|null;sourceIds:string[];
}
const inputKeys=["title","agencyComponentId","agencyLabel","recordsDescription","rangeStart","rangeEnd","sourceIds"];
export function validateTemplateInput(raw:unknown):TemplateInput {
  if(!raw || typeof raw!=="object" || Array.isArray(raw))throw new RegistryError("Expected an object");
  const r=raw as Record<string,unknown>;
  for(const k of Object.keys(r))if(!inputKeys.includes(k))throw new RegistryError("Unknown field: "+k);
  const input={title:String(r.title??""),agencyComponentId:String(r.agencyComponentId??"").toLowerCase(),
    agencyLabel:String(r.agencyLabel??""),recordsDescription:String(r.recordsDescription??""),
    rangeStart:(r.rangeStart??null) as string|null,rangeEnd:(r.rangeEnd??null) as string|null,
    sourceIds:Array.isArray(r.sourceIds)?r.sourceIds.map(String):[]};
  if(input.agencyLabel.trim().length<3 || input.agencyLabel.length>250)throw new RegistryError("Agency label is required");
  try{validateRequestTemplate({...input,templateId:"tpl-validate",version:1,state:"draft",editorId:"validator",reviewerId:null});}
  catch{throw new RegistryError("Invalid template: check agency component id, description (25+ characters), dates and source ids");}
  return input;
}
function slug(title:string){return ("tpl-"+title.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")).slice(0,60).replace(/-$/,"")||"tpl-template";}

export async function listTemplateVersions(db:Db,limit=200):Promise<TemplateVersion[]> {
  return (await db.query<TemplateRow>(`SELECT ${tcols} FROM tpr_public.request_template_versions
    ORDER BY template_id,version DESC LIMIT $1`,[limit])).rows.map(toVersion);
}
export async function getTemplateVersion(db:Db,id:string,version:number):Promise<TemplateVersion|null> {
  const r=await db.query<TemplateRow>(`SELECT ${tcols} FROM tpr_public.request_template_versions WHERE template_id=$1 AND version=$2`,[id,version]);
  return r.rows[0]?toVersion(r.rows[0]):null;
}
/** Latest published version of each template (the public, adoptable catalog). */
export async function publishedTemplatesFromDb(db:Db):Promise<CatalogTemplate[]> {
  return (await db.query<TemplateRow>(`SELECT ${tcols} FROM tpr_public.request_template_versions WHERE state='published'
    ORDER BY title LIMIT 500`)).rows.map(r=>{const v=toVersion(r);return {...v,state:"published" as const};});
}
/** New template (version 1) or a new version of an existing template. */
export async function createTemplateVersion(db:Db,actor:string,input:TemplateInput,templateId:string|null):Promise<TemplateVersion> {
  let id=templateId, version=1;
  if(id){
    if(!/^[a-zA-Z0-9_-]{3,128}$/.test(id))throw new RegistryError("Invalid template id");
    const max=await db.query<{v:number|null}>("SELECT max(version) AS v FROM tpr_public.request_template_versions WHERE template_id=$1",[id]);
    if(max.rows[0].v===null)throw new RegistryError("Template not found",404);
    version=max.rows[0].v+1;
  }else{
    id=slug(input.title);
    const taken=await db.query("SELECT 1 FROM tpr_public.request_template_versions WHERE template_id=$1",[id]);
    if(taken.rowCount)id=id.slice(0,50)+"-"+Math.random().toString(36).slice(2,8);
  }
  const r=await db.query<TemplateRow>(`INSERT INTO tpr_public.request_template_versions
    (template_id,version,title,agency_component_id,agency_label,records_description,range_start,range_end,source_ids,editor_subject)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${tcols}`,
    [id,version,input.title,input.agencyComponentId,input.agencyLabel,input.recordsDescription,input.rangeStart,input.rangeEnd,input.sourceIds,actor]);
  await recordAudit(db,{owner:actor,actor,action:"template_version_saved",objectKind:"request_template",objectId:`${id}:v${version}`});
  return toVersion(r.rows[0]);
}
export async function updateTemplateDraft(db:Db,actor:string,id:string,version:number,input:TemplateInput):Promise<TemplateVersion> {
  const r=await db.query<TemplateRow>(`UPDATE tpr_public.request_template_versions SET title=$4,agency_component_id=$5,agency_label=$6,
    records_description=$7,range_start=$8,range_end=$9,source_ids=$10
    WHERE template_id=$1 AND version=$2 AND editor_subject=$3 AND state='draft' RETURNING ${tcols}`,
    [id,version,actor,input.title,input.agencyComponentId,input.agencyLabel,input.recordsDescription,input.rangeStart,input.rangeEnd,input.sourceIds]);
  if(!r.rows[0])throw new RegistryError("Only your own unsubmitted drafts can be edited",409);
  await recordAudit(db,{owner:actor,actor,action:"template_version_saved",objectKind:"request_template",objectId:`${id}:v${version}`});
  return toVersion(r.rows[0]);
}
export type TemplateAction="submit"|"approve"|"reject"|"retire";
export async function transitionTemplate(db:Db,actor:string,id:string,version:number,action:TemplateAction,note:string|null):Promise<TemplateVersion> {
  if(note!==null && (typeof note!=="string" || note.length>1000))throw new RegistryError("Note too long");
  const current=await getTemplateVersion(db,id,version);
  if(!current)throw new RegistryError("Template version not found",404);
  const next={submit:"in_review",approve:"published",reject:"rejected",retire:"retired"}[action];
  if(action==="approve"){
    // Supersede the previously published version in the same transaction.
    await db.query("UPDATE tpr_public.request_template_versions SET state='retired' WHERE template_id=$1 AND state='published'",[id]);
  }
  const reviewing=action==="approve"||action==="reject";
  const r=await db.query<TemplateRow>(`UPDATE tpr_public.request_template_versions SET state=$3,
      reviewer_subject=CASE WHEN $4 THEN $5 ELSE reviewer_subject END,
      reviewed_at=CASE WHEN $4 THEN now() ELSE reviewed_at END,
      review_note=CASE WHEN $4 THEN $6 ELSE review_note END
    WHERE template_id=$1 AND version=$2 RETURNING ${tcols}`,[id,version,next,reviewing,actor,note]).catch((e:{message?:string})=>{
      throw new RegistryError(e?.message?.includes("transition")||e?.message?.includes("check constraint")?
        "That change is not allowed for this version (independent review required)":"Update failed",409);
    });
  await recordAudit(db,{owner:actor,actor,action:reviewing?"template_version_reviewed":"template_version_saved",
    objectKind:"request_template",objectId:`${id}:v${version}`});
  return toVersion(r.rows[0]);
}

// ---- Filing routes (TPR-12)
interface RouteRow {
  id:string;agency_component_id:string;source_url:string;channel_kind:"portal"|"email";channel_value:string;acknowledgement:string;
  approval:"pending"|"approved"|"rejected"|"superseded";proposed_by:string;proposed_at:Date;verified_by:string|null;verified_at:Date|null;
}
export interface FilingRouteRecord {
  id:string;agencyComponentId:string;sourceUrl:string;channel:ReviewedFilingRoute["channel"];acknowledgement:string;
  approval:RouteRow["approval"];proposedBy:string;proposedAt:string;verifiedBy:string|null;verifiedAt:string|null;
}
const toRoute=(r:RouteRow):FilingRouteRecord=>({id:r.id,agencyComponentId:r.agency_component_id,sourceUrl:r.source_url,
  channel:r.channel_kind==="portal"?{kind:"portal",portalUrl:r.channel_value}:{kind:"email",emailAddress:r.channel_value},
  acknowledgement:r.acknowledgement,approval:r.approval,proposedBy:r.proposed_by,proposedAt:r.proposed_at.toISOString(),
  verifiedBy:r.verified_by,verifiedAt:r.verified_at?.toISOString()??null});
const rcols="id::text,agency_component_id,source_url,channel_kind,channel_value,acknowledgement,approval,proposed_by,proposed_at,verified_by,verified_at";

export async function trustedHosts(db:Db):Promise<{source:string[];channel:string[]}> {
  const r=await db.query<{host:string;purpose:string}>("SELECT host,purpose FROM tpr_public.filing_trusted_hosts");
  return {source:r.rows.filter(x=>x.purpose!=="channel").map(x=>x.host),channel:r.rows.filter(x=>x.purpose!=="source").map(x=>x.host)};
}
export async function addTrustedHost(db:Db,actor:string,host:unknown,purpose:unknown,reason:unknown):Promise<void> {
  if(typeof host!=="string" || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host) || host.length>253 ||
     !["source","channel","both"].includes(purpose as string) || typeof reason!=="string" || reason.trim().length<3 || reason.length>500)
    throw new RegistryError("Provide an exact lower-case host, purpose and reason");
  await db.query(`INSERT INTO tpr_public.filing_trusted_hosts(host,purpose,added_by,reason) VALUES($1,$2,$3,$4)
    ON CONFLICT (host) DO NOTHING`,[host,purpose,actor,reason]);
  await recordAudit(db,{owner:actor,actor,action:"trusted_host_added",objectKind:"trusted_host",objectId:host});
}
/** Checks a route as if approved now; rejects destinations outside the reviewed host lists. */
async function checkRoute(db:Db,route:Omit<FilingRouteRecord,"id"|"approval"|"proposedAt"|"verifiedBy"|"verifiedAt">):Promise<void> {
  const hosts=await trustedHosts(db);
  const g=evaluateFilingRoute({agencyComponentId:route.agencyComponentId,sourceUrl:route.sourceUrl,verifiedBy:"pending-check",
    verifiedAt:new Date().toISOString(),approval:"approved",channel:route.channel},hosts.source,hosts.channel);
  if(g.status!=="verified")throw new RegistryError("The source and destination must be HTTPS/email on exact trusted official hosts");
}
export async function proposeRoute(db:Db,actor:string,raw:unknown):Promise<FilingRouteRecord> {
  if(!raw || typeof raw!=="object")throw new RegistryError("Expected an object");
  const r=raw as Record<string,unknown>;
  const kind=r.channelKind, value=typeof r.channelValue==="string"?r.channelValue.trim():"";
  if(kind!=="portal" && kind!=="email")throw new RegistryError("channelKind must be portal or email");
  if(typeof r.acknowledgement!=="string" || r.acknowledgement.trim().length<3 || r.acknowledgement.length>400)throw new RegistryError("Acknowledgement guidance is required");
  const route={agencyComponentId:String(r.agencyComponentId??"").toLowerCase(),sourceUrl:String(r.sourceUrl??""),
    channel:(kind==="portal"?{kind,portalUrl:value}:{kind,emailAddress:value}) as ReviewedFilingRoute["channel"],
    acknowledgement:r.acknowledgement.trim(),proposedBy:actor};
  await checkRoute(db,route);
  const row=await db.query<RouteRow>(`INSERT INTO tpr_public.filing_routes(agency_component_id,source_url,channel_kind,channel_value,acknowledgement,proposed_by)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING ${rcols}`,[route.agencyComponentId,route.sourceUrl,kind,value,route.acknowledgement,actor]);
  await recordAudit(db,{owner:actor,actor,action:"filing_route_proposed",objectKind:"filing_route",objectId:row.rows[0].id});
  return toRoute(row.rows[0]);
}
export async function getRoute(db:Db,id:string):Promise<FilingRouteRecord|null> {
  if(!/^[0-9a-f-]{36}$/.test(id))return null;
  const r=await db.query<RouteRow>(`SELECT ${rcols} FROM tpr_public.filing_routes WHERE id=$1`,[id]);
  return r.rows[0]?toRoute(r.rows[0]):null;
}
export async function listRoutes(db:Db):Promise<FilingRouteRecord[]> {
  return (await db.query<RouteRow>(`SELECT ${rcols} FROM tpr_public.filing_routes ORDER BY proposed_at DESC LIMIT 500`)).rows.map(toRoute);
}
export async function reviewRoute(db:Db,actor:string,id:string,action:"approve"|"reject"|"reverify"):Promise<FilingRouteRecord> {
  const route=await getRoute(db,id);
  if(!route)throw new RegistryError("Route not found",404);
  if(action!=="reject")await checkRoute(db,route); // hosts must still be trusted at verification time
  if(action==="approve")
    await db.query("UPDATE tpr_public.filing_routes SET approval='superseded' WHERE agency_component_id=$1 AND approval='approved'",[route.agencyComponentId]);
  const next=action==="reject"?"rejected":"approved";
  const r=await db.query<RouteRow>(`UPDATE tpr_public.filing_routes SET approval=$2,verified_by=$3,verified_at=now() WHERE id=$1 RETURNING ${rcols}`,
    [id,next,actor]).catch(()=>{throw new RegistryError("That change is not allowed for this route (independent verification required)",409);});
  await recordAudit(db,{owner:actor,actor,action:"filing_route_reviewed",objectKind:"filing_route",objectId:id});
  return toRoute(r.rows[0]);
}
/** Approved routes + trusted hosts as the self-filing guide's registry. */
export async function filingRegistryFromDb(db:Db):Promise<FilingRegistry> {
  const hosts=await trustedHosts(db);
  const rows=(await db.query<RouteRow>(`SELECT ${rcols} FROM tpr_public.filing_routes WHERE approval='approved'`)).rows.map(toRoute);
  const routes:RouteWithInstructions[]=rows.map(r=>({agencyComponentId:r.agencyComponentId,sourceUrl:r.sourceUrl,verifiedBy:r.verifiedBy!,
    verifiedAt:r.verifiedAt!,approval:"approved",channel:r.channel,acknowledgement:r.acknowledgement}));
  return {synthetic:false,trustedSourceHosts:hosts.source,trustedChannelHosts:hosts.channel,routes};
}
export type {RequestTemplate};

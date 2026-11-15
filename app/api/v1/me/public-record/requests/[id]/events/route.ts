import type {NextRequest} from "next/server";
import {createFederalCalendar} from "../../../../../../../../lib/clock/federal-calendar";
import {computeFoiaClock} from "../../../../../../../../lib/clock/foia-clock";
import {clockInputFromProjection,rebuildLifecycle} from "../../../../../../../../lib/lifecycle/projection";
import {BadRequest,json,problem,readJson} from "../../../../../../../../lib/server/http";
import {canUseOwnDraft} from "../../../../../../../../lib/server/auth-context";
import {idempotencyKeyFrom,withMember} from "../../../../../../../../lib/server/member-route";
import type {NewLifecycleEvent} from "../../../../../../../../lib/lifecycle/repository";

export const dynamic="force-dynamic";
type Params={params:Promise<{id:string}>};
const calendar=createFederalCalendar();
const fields=["type","occurredOn","assertedBy","verification","evidenceRef","causedBy","correctsEventId","payload"];

export function GET(req:NextRequest,{params}:Params){
  return withMember(req,"events.list",async ctx=>{
    const {id}=await params;
    if(!canUseOwnDraft(ctx,ctx.session.subject,"read"))return problem(403,"Not permitted");
    const events=await ctx.drafts.listEvents(ctx.session,id);
    if(!events)return problem(404,"Request not found");
    const projection=rebuildLifecycle(id,events);
    const today=new Date().toISOString().slice(0,10);
    return json({projection,clock:computeFoiaClock(clockInputFromProjection(projection,today),calendar)});
  });
}
/** Record a participant-reported or document-backed event. Reviewer verification is a separate role. */
export function POST(req:NextRequest,{params}:Params){
  return withMember(req,"events.append",async ctx=>{
    const {id}=await params;
    if(!canUseOwnDraft(ctx,ctx.session.subject,"update"))return problem(403,"Not permitted");
    const body=await readJson(req) as Record<string,unknown>;
    if(!body || typeof body!=="object" || Object.keys(body).some(k=>!fields.includes(k)))throw new BadRequest("Unknown event field");
    const input:NewLifecycleEvent={type:body.type as NewLifecycleEvent["type"],occurredOn:body.occurredOn as string,
      assertedBy:(body.assertedBy??"requester") as NewLifecycleEvent["assertedBy"],
      verification:(body.verification??"self_reported") as NewLifecycleEvent["verification"],
      evidenceRef:(body.evidenceRef??null) as string|null,causedBy:(body.causedBy??null) as string|null,
      correctsEventId:(body.correctsEventId??null) as string|null,payload:(body.payload??{}) as NewLifecycleEvent["payload"]};
    if(typeof input.occurredOn==="string" && input.occurredOn>new Date().toISOString().slice(0,10))
      throw new BadRequest("Events cannot be dated in the future");
    const result=await ctx.drafts.appendEvent(ctx.session,id,input,idempotencyKeyFrom(req));
    if(!result)return problem(404,"Request not found");
    return json(result,{status:result.replayed?200:201});
  });
}

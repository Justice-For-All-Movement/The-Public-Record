import type {NextRequest,NextResponse} from "next/server";
import type {PoolClient} from "pg";
import {withMember,type MemberRouteContext} from "./member-route";
import {problem} from "./http";
import {withSubject} from "./db";
import {uploadServices,type UploadServices} from "./storage";
import {PublicationError} from "../publication/publication";

/** Member or reviewer publication routes: PostgreSQL + private storage, RLS with server-owned roles. */
export function withPublication(req:NextRequest,route:string,needReviewer:boolean,
  handler:(ctx:MemberRouteContext,db:PoolClient,svc:UploadServices)=>Promise<NextResponse>):Promise<NextResponse> {
  return withMember(req,route,async ctx=>{
    const svc=uploadServices();
    if(ctx.store.kind!=="postgres" || !svc.ok)return problem(503,"Publication needs the database and private storage");
    if(needReviewer && !ctx.principal.roles.includes("records_reviewer"))return problem(403,"Records reviewers only");
    try{return await withSubject(ctx.session,db=>handler(ctx,db,svc.services),ctx.principal.roles);}
    catch(e){if(e instanceof PublicationError)return problem(e.status,e.message);throw e;}
  });
}

import type {NextRequest,NextResponse} from "next/server";
import type {PoolClient} from "pg";
import {withMember,type MemberRouteContext} from "./member-route";
import {problem} from "./http";
import {withSubject} from "./db";
import {RegistryError} from "../registry/reviewed-registry";

/**
 * Editorial/reviewer routes: a verified member with server-owned roles, a
 * PostgreSQL deployment, and the caller's own audited RLS transaction.
 * Per-object authorization (authorize()) is checked inside each handler.
 */
export function withEditor(req:NextRequest,route:string,
  handler:(ctx:MemberRouteContext,db:PoolClient)=>Promise<NextResponse>):Promise<NextResponse> {
  return withMember(req,route,async ctx=>{
    if(ctx.store.kind!=="postgres")return problem(503,"Editorial tools need the database");
    if(!ctx.principal.roles.some(r=>["editor","records_reviewer","admin"].includes(r)))return problem(403,"Not permitted");
    try{return await withSubject(ctx.session,db=>handler(ctx,db));}
    catch(e){if(e instanceof RegistryError)return problem(e.status,e.message);throw e;}
  });
}

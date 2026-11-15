import type {Metadata} from "next";
import Link from "next/link";
import {pageAuth} from "../../../lib/server/page-auth";
import {withSubject} from "../../../lib/server/db";
import {listRoutes,listTemplateVersions} from "../../../lib/registry/reviewed-registry";
import {authorize} from "../../../lib/auth/authorization";
import {ActionButton} from "../../../components/member-actions";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Review queue | The Public Record",robots:{index:false}};
const box={border:"1px solid #c4ceca",borderRadius:12,padding:18,marginTop:18,background:"#fff"} as const;

/** TPR-12/17 review queue for editors, records reviewers and admins. Authoring is via the admin API. */
export default async function ReviewQueue(){
  const auth=await pageAuth();
  const allowed=auth.ok && auth.ctx.store.kind==="postgres" && auth.ctx.principal.roles.some(r=>["editor","records_reviewer","admin"].includes(r));
  if(!auth.ok || !allowed)return <main style={{maxWidth:900,margin:"auto",padding:"48px 20px"}}><Link href="/me">← My requests</Link>
    <h1>Review queue</h1><p>This page is for assigned editors and records reviewers.</p></main>;
  const {session,principal}=auth.ctx;
  const [versions,routes]=await withSubject(session,async db=>[await listTemplateVersions(db),await listRoutes(db)] as const);
  const pending=versions.filter(v=>v.state==="in_review");
  const mine=versions.filter(v=>v.state==="draft" && v.editorId===session.subject);
  const pendingRoutes=routes.filter(r=>r.approval==="pending");
  return <main style={{maxWidth:900,margin:"auto",padding:"48px 20px"}}>
    <Link href="/me">← My requests</Link>
    <h1>Review queue</h1>
    <p>Templates need a different editor or a records reviewer to publish. Filing routes need a records reviewer or admin other than the proposer, and only exact trusted hosts are accepted.</p>
    <section style={box}><h2>Templates awaiting review ({pending.length})</h2>
      {pending.map(v=><article key={v.templateId+v.version} style={{borderTop:"1px solid #e2e6e4",paddingTop:10}}>
        <h3 style={{margin:"4px 0"}}>{v.title} <small>({v.templateId} v{v.version})</small></h3>
        <p>{v.agencyLabel} · {v.rangeStart??"open"} to {v.rangeEnd??"open"}</p><p>{v.recordsDescription}</p>
        {authorize(principal,"publish",{kind:"request_template",author:v.editorId})
          ? <><ActionButton url={`/api/v1/admin/public-record/templates/${v.templateId}/${v.version}`} body={{action:"approve"}} label="Approve and publish"/>{" "}
             <ActionButton url={`/api/v1/admin/public-record/templates/${v.templateId}/${v.version}`} body={{action:"reject"}} label="Reject"/></>
          : <p><em>You authored this version; another reviewer must decide.</em></p>}
      </article>)}
    </section>
    <section style={box}><h2>Your unsubmitted drafts ({mine.length})</h2>
      {mine.map(v=><p key={v.templateId+v.version}>{v.title} (v{v.version}){" "}
        <ActionButton url={`/api/v1/admin/public-record/templates/${v.templateId}/${v.version}`} body={{action:"submit"}} label="Submit for review"/></p>)}
    </section>
    <section style={box}><h2>Filing routes awaiting verification ({pendingRoutes.length})</h2>
      {pendingRoutes.map(r=><article key={r.id} style={{borderTop:"1px solid #e2e6e4",paddingTop:10}}>
        <p>Component {r.agencyComponentId}: {r.channel.kind==="portal"?r.channel.portalUrl:r.channel.emailAddress} (source {r.sourceUrl})</p>
        {authorize(principal,"review",{kind:"filing_route",proposer:r.proposedBy})
          ? <><ActionButton url={`/api/v1/admin/public-record/filing-routes/${r.id}`} body={{action:"approve"}} label="Verify and approve"/>{" "}
             <ActionButton url={`/api/v1/admin/public-record/filing-routes/${r.id}`} body={{action:"reject"}} label="Reject"/></>
          : <p><em>Needs a records reviewer or admin other than the proposer.</em></p>}
      </article>)}
    </section>
  </main>;
}

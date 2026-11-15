import type {Metadata} from "next";
import Link from "next/link";
import {config} from "../../lib/server/config";
import {pageAuth} from "../../lib/server/page-auth";
import {draftStoreFor} from "../../lib/server/draft-store";
import {AdoptButton} from "../../components/member-actions";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"My requests | The Public Record",robots:{index:false}};
const box={border:"1px solid #c4ceca",borderRadius:12,padding:20,marginTop:20,background:"#fff"} as const;
type Search=Promise<Record<string,string|string[]|undefined>>;

export default async function MemberDashboard({searchParams}:{searchParams:Search}){
  const q=await searchParams;
  const cfg=config();
  const auth=await pageAuth();
  const banner=cfg.authMode==="fake"?<p role="note" style={{background:"#fff3cd",padding:12,borderRadius:8}}>
    Preview with synthetic test identities{auth.ok && auth.ctx.store.kind==="memory"?" and temporary in-memory storage that resets on restart":""}. Do not enter real personal information.</p>:null;
  if(!auth.ok){
    return <main style={{maxWidth:860,margin:"auto",padding:"48px 20px"}}>
      <Link href="/">← The Public Record</Link>{banner}
      <h1>My requests</h1>
      {q.signin==="failed" && <p role="alert">Sign-in did not complete. Please try again.</p>}
      {q.signin==="locked" && <p role="alert">This account cannot sign in. Contact the site operators.</p>}
      {auth.status===401
        ? <p><a href="/api/auth/login?returnTo=/me">Sign in</a> to save private drafts and track requests you file yourself.</p>
        : <p>Member accounts are not available in this deployment yet. You can still <Link href="/public-record/prepare">draft a request privately in your browser</Link>.</p>}
    </main>;
  }
  const {session,principal,store}=auth.ctx;
  const drafts=await draftStoreFor(store).list(session);
  const activity=(await store.listAudit(session)).slice(0,10);
  return <main style={{maxWidth:860,margin:"auto",padding:"48px 20px"}}>
    <Link href="/">← The Public Record</Link>{banner}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",flexWrap:"wrap",gap:12}}>
      <h1>My requests</h1>
      <form method="post" action="/api/auth/logout"><button type="submit">Sign out</button></form>
    </div>
    <p>Only you can see this page. Roles: {principal.roles.join(", ")}.</p>
    <section style={box} aria-labelledby="drafts">
      <h2 id="drafts">Private drafts and requests</h2>
      {drafts.length===0 && <p>No drafts yet. <Link href="/public-record/work">Browse reviewed request templates</Link> or start from scratch.</p>}
      <ul>{drafts.map(d=><li key={d.id} style={{marginBottom:8}}>
        <Link href={`/me/drafts/${d.id}`}>{d.title||"Untitled request"}</Link>
        {d.templateId && <span style={{color:"#465451"}}> — template {d.templateId} v{d.templateVersion}</span>}
        <span style={{color:"#465451"}}> · updated {d.updatedAt.slice(0,10)}</span></li>)}</ul>
      <AdoptButton templateId={null} label="Start a blank draft"/>
    </section>
    <section style={box} aria-labelledby="activity">
      <h2 id="activity">Recent account activity</h2>
      <ul>{activity.map((a,i)=><li key={i}>{a.occurredAt.slice(0,16).replace("T"," ")} UTC — {a.action.replace(/_/g," ")}</li>)}</ul>
    </section>
  </main>;
}

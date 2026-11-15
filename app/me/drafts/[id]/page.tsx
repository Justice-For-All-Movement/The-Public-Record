import type {Metadata} from "next";
import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {pageAuth} from "../../../../lib/server/page-auth";
import {draftStoreFor} from "../../../../lib/server/draft-store";
import {lintDraft} from "../../../../lib/adoption/draft-lint";
import {rebuildLifecycle,clockInputFromProjection,verificationWords} from "../../../../lib/lifecycle/projection";
import {computeFoiaClock} from "../../../../lib/clock/foia-clock";
import {createFederalCalendar} from "../../../../lib/clock/federal-calendar";
import {DraftEditor,EventRecorder} from "../../../../components/member-actions";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Draft | The Public Record",robots:{index:false}};
const box={border:"1px solid #c4ceca",borderRadius:12,padding:20,marginTop:20,background:"#fff"} as const;
const calendar=createFederalCalendar();

export default async function DraftPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const auth=await pageAuth();
  if(!auth.ok)redirect(`/me`);
  const store=draftStoreFor(auth.ctx.store);
  const draft=await store.get(auth.ctx.session,id);
  if(!draft)notFound();
  const events=(await store.listEvents(auth.ctx.session,id))??[];
  const projection=rebuildLifecycle(id,events);
  const clock=computeFoiaClock(clockInputFromProjection(projection,new Date().toISOString().slice(0,10)),calendar);
  const lint=lintDraft(draft);
  const d=clock.determination;
  return <main style={{maxWidth:900,margin:"auto",padding:"48px 20px"}}>
    <Link href="/me">← My requests</Link>
    <h1 style={{marginBottom:4}}>{draft.title||"Untitled request"}</h1>
    <p style={{color:"#465451",marginTop:0}}>{draft.agencyLabel??"Agency not selected"}{draft.templateId?` · pinned to template ${draft.templateId} v${draft.templateVersion}`:""}</p>
    <p><strong>Status:</strong> {projection.status?.label??"Not started"}</p>
    <section style={box} aria-labelledby="edit"><h2 id="edit">Draft (private)</h2>
      <DraftEditor initial={draft}/>
      {lint.length>0 && <><h3>Drafting checks</h3><ul>{lint.map(i=><li key={i.code}><strong>{i.severity}:</strong> {i.message}</li>)}</ul></>}
      <p style={{fontSize:14,color:"#465451"}}>You file this request yourself using the agency&apos;s official instructions. The Public Record never submits requests for you.</p>
    </section>
    <section style={box} aria-labelledby="clock"><h2 id="clock">Response timing estimate</h2>
      <p>{d.dueOn?`Estimated determination date: ${d.dueOn}${d.dueLatestOn&&d.dueLatestOn!==d.dueOn?` – ${d.dueLatestOn}`:""}`:`No date estimated (${d.status.replace(/_/g," ")}).`}</p>
      {clock.appeal.minimumWindowEndsOn && <p>Appeal window: at least through {clock.appeal.minimumWindowEndsOn}; follow the letter&apos;s instructions.</p>}
      <ul>{clock.notes.map(n=><li key={n}>{n}</li>)}</ul>
      <p style={{fontSize:14,color:"#465451"}}>{clock.disclaimer}</p>
    </section>
    <section style={box} aria-labelledby="timeline"><h2 id="timeline">Timeline</h2>
      {projection.conflicts.length>0 && <ul role="alert">{projection.conflicts.map((c,i)=><li key={i}>{c.message}</li>)}</ul>}
      <ol>{projection.history.map(h=><li key={h.event.id+h.state} style={{marginBottom:6}}>
        <strong>{h.event.occurredOn}</strong> — {h.event.type.replace(/_/g," ")} ({verificationWords(h.event.verification,h.event.assertedBy)})
        {h.state!=="applied" && <em> [{h.state.replace(/_/g," ")}]</em>}</li>)}</ol>
      <h3>Record what happened</h3>
      <EventRecorder requestId={id}/>
    </section>
  </main>;
}

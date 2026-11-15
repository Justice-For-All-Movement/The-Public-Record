import type {Metadata} from "next";
import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {pageAuth} from "../../../../lib/server/page-auth";
import {draftStoreFor} from "../../../../lib/server/draft-store";
import {lintDraft} from "../../../../lib/adoption/draft-lint";
import {rebuildLifecycle,clockInputFromProjection,verificationWords} from "../../../../lib/lifecycle/projection";
import {computeFoiaClock} from "../../../../lib/clock/foia-clock";
import {createFederalCalendar} from "../../../../lib/clock/federal-calendar";
import {AppealLetterBuilder,DraftEditor,EventRecorder,ProofCheck} from "../../../../components/member-actions";
import {feeStatus} from "../../../../lib/lifecycle/fees";
import {appealAssistance} from "../../../../lib/appeals/appeal-assistant";
import {buildSelfFilingGuide} from "../../../../lib/filing/self-filing-guide";
import {filingRegistry} from "../../../../lib/filing/registry";
import {isProofReference} from "../../../../lib/filing/proof-fingerprint";
import {config} from "../../../../lib/server/config";

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
  const fees=feeStatus(projection.history.filter(h=>h.effective).map(h=>h.effective!),draft.feeCapUsd);
  const appeal=appealAssistance(projection,clock);
  const guide=buildSelfFilingGuide(draft.agencyComponentRef,filingRegistry(config().stage));
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
    <section style={box} aria-labelledby="file"><h2 id="file">File it yourself</h2>
      {guide.synthetic && <p role="note" style={{background:"#fff3cd",padding:10,borderRadius:8}}>Preview: this agency and its filing route are fictional.</p>}
      <ol>{guide.steps.map(s=><li key={s.id} style={{marginBottom:8}}><strong>{s.title}.</strong> {s.detail}
        {s.link && <> <a href={s.link.href} rel="noopener noreferrer" target={s.link.href.startsWith("mailto:")?undefined:"_blank"}>{s.link.label}</a></>}</li>)}</ol>
    </section>
    <section style={box} aria-labelledby="clock"><h2 id="clock">Response timing estimate</h2>
      <p>{d.dueOn?`Estimated determination date: ${d.dueOn}${d.dueLatestOn&&d.dueLatestOn!==d.dueOn?` – ${d.dueLatestOn}`:""}`:`No date estimated (${d.status.replace(/_/g," ")}).`}</p>
      {clock.appeal.minimumWindowEndsOn && <p>Appeal window: at least through {clock.appeal.minimumWindowEndsOn}; follow the letter&apos;s instructions.</p>}
      <ul>{clock.notes.map(n=><li key={n}>{n}</li>)}</ul>
      <p style={{fontSize:14,color:"#465451"}}>{clock.disclaimer}</p>
    </section>
    {fees.state!=="no_estimate" && <section style={box} aria-labelledby="fees"><h2 id="fees">Fees</h2>
      <p role={fees.state==="above_ceiling_awaiting_decision"?"alert":undefined}>{fees.message}</p>
      <p style={{fontSize:14,color:"#465451"}}>Your ceiling is a limit you set, not a promise that you will owe nothing. Change it in the draft above if you decide to.</p>
    </section>}
    {appeal.eligible && <section style={box} aria-labelledby="appeal"><h2 id="appeal">Appeal or mediation options</h2>
      <p>{appeal.reason}</p>{appeal.windowText && <p>{appeal.windowText}</p>}
      {appeal.alreadyAppealed && <p>You have recorded an appeal for this request.</p>}
      <ul>{appeal.resources.map(r=><li key={r.url}><a href={r.url} rel="noopener noreferrer" target="_blank">{r.label}</a></li>)}</ul>
      <AppealLetterBuilder suggested={appeal.suggestedGrounds} input={{agencyLabel:draft.agencyLabel,
        trackingNumber:projection.facts.agencyTrackingNumber,requestTitle:draft.title,determinationOn:appeal.determinationOn!}}/>
      <p style={{fontSize:14,color:"#465451"}}>This is general information, not legal advice. The Public Record does not file appeals for you.</p>
    </section>}
    <section style={box} aria-labelledby="timeline"><h2 id="timeline">Timeline</h2>
      {projection.conflicts.length>0 && <ul role="alert">{projection.conflicts.map((c,i)=><li key={i}>{c.message}</li>)}</ul>}
      <ol>{projection.history.map(h=><li key={h.event.id+h.state} style={{marginBottom:6}}>
        <strong>{h.event.occurredOn}</strong> — {h.event.type.replace(/_/g," ")} ({verificationWords(h.event.verification,h.event.assertedBy)})
        {h.state!=="applied" && <em> [{h.state.replace(/_/g," ")}]</em>}
        {isProofReference(h.event.evidenceRef) && <div><ProofCheck reference={h.event.evidenceRef}/></div>}</li>)}</ol>
      <h3>Record what happened</h3>
      <EventRecorder requestId={id} confirmation={guide.confirmation}/>
    </section>
  </main>;
}

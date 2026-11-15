import type {Metadata} from "next";
import Link from "next/link";
import {templateCatalog,toWorkCards} from "../../../lib/server/catalog";
import {AdoptButton} from "../../../components/member-actions";

export const metadata:Metadata={title:"Request templates | The Public Record",description:"Reviewed FOIA request templates you can adopt and file yourself."};
export const dynamic="force-dynamic";
export default async function WorkCards(){
  const catalog=await templateCatalog();
  const cards=toWorkCards(catalog);
  return <main style={{maxWidth:900,margin:"auto",padding:"48px 20px"}}>
    <Link href="/">← The Public Record</Link>
    <h1>Reviewed request templates</h1>
    {catalog.synthetic && <p role="note" style={{background:"#fff3cd",padding:12,borderRadius:8}}>These templates are fictional examples for the preview. The agencies and records do not exist.</p>}
    <p>Adopting a template saves a private copy pinned to that reviewed version. You edit it, then file it yourself with the agency.</p>
    {cards.length===0 && <p>No reviewed templates are published yet.</p>}
    {cards.map(c=><article key={c.templateId} style={{border:"1px solid #c4ceca",borderRadius:12,padding:18,marginTop:16,background:"#fff"}}>
      <h2 style={{marginTop:0,fontSize:20}}>{c.title}</h2>
      <p style={{color:"#465451"}}>{c.agencyLabel} · version {c.version}{c.rangeStart?` · ${c.rangeStart} to ${c.rangeEnd??"present"}`:""}</p>
      <p>{c.recordsSummary}</p>
      <AdoptButton templateId={c.templateId} label="Adopt privately"/>
    </article>)}
  </main>;
}

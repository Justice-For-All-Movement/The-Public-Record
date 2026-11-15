import type {Metadata} from "next";
import Link from "next/link";
import {searchArchive} from "../../../lib/server/archive";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Search released records | The Public Record",
  description:"Check whether records were already released before filing a new request."};
type Search=Promise<Record<string,string|string[]|undefined>>;
const holdingText={archived_copy_with_hash:"Archived copy (SHA-256 recorded)",indexed_link_only:"Index link only — copy not verified"};

export default async function ArchiveSearch({searchParams}:{searchParams:Search}){
  const q=(await searchParams).q;
  const query=typeof q==="string"?q:"";
  const result=query?await searchArchive(query):null;
  return <main style={{maxWidth:900,margin:"auto",padding:"48px 20px"}}>
    <Link href="/">← The Public Record</Link>
    <h1>Search already-released records</h1>
    <p>Before filing, check whether an agency has already released what you are looking for. Results come from the FOIA Aggregator public archive, which covers only part of what agencies publish.</p>
    <form method="get" style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      <label style={{flex:"1 1 320px"}}><span style={{display:"block"}}>Describe the records</span>
        <input name="q" defaultValue={query} minLength={3} maxLength={300} style={{font:"inherit",padding:8,width:"100%",boxSizing:"border-box"}}/></label>
      <button type="submit" style={{alignSelf:"end"}}>Search</button>
    </form>
    {result && <section aria-live="polite" style={{marginTop:24}}>
      <ul role="note" style={{background:"#eef2f0",padding:"12px 28px",borderRadius:8}}>{result.warnings.map(w=><li key={w}>{w}</li>)}</ul>
      {result.records.map(r=><article key={r.id} style={{border:"1px solid #c4ceca",borderRadius:10,padding:14,marginTop:12,background:"#fff"}}>
        <h2 style={{fontSize:18,margin:0}}><a href={r.recordUrl} rel="noopener noreferrer nofollow">{r.title}</a></h2>
        <p style={{margin:"6px 0",color:"#465451"}}>{r.agency}{r.office?` — ${r.office}`:""}{r.publishedDate?` · published ${r.publishedDate}`:" · publication date not recorded"} · {holdingText[r.holding]}{r.textIndexed?" · text indexed":""}</p>
        {r.sourceUrl && <p style={{margin:0,fontSize:14}}>Found at: <a href={r.sourceUrl} rel="noopener noreferrer nofollow">{new URL(r.sourceUrl).hostname}</a>{r.sourceProvenance==="third_party"?" (third-party source)":" (official source)"}</p>}
      </article>)}
      {result.provenance.snapshotId && <p style={{fontSize:14,color:"#465451"}}>Catalog snapshot {result.provenance.snapshotId}{result.provenance.observedAt?` generated ${result.provenance.observedAt.slice(0,10)}`:""} · searched {result.provenance.searchedRecords} of {result.provenance.catalogRecords} entries · contract {result.provenance.contractVersion}</p>}
      <h2 style={{fontSize:18}}>Also check official sources</h2>
      <ul>{result.fallback.map(f=><li key={f.url}><a href={f.url}>{f.label}</a></li>)}</ul>
    </section>}
  </main>;
}

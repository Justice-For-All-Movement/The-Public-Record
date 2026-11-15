"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {checkProof,proofReference,sha256Hex} from "../lib/filing/proof-fingerprint";
import {draftAppealLetter,type AppealGround} from "../lib/appeals/appeal-assistant";

const key=()=>Array.from(crypto.getRandomValues(new Uint8Array(18)),b=>b.toString(16).padStart(2,"0")).join("");
async function problemText(res:Response){
  try{const p=await res.json() as {title?:string;detail?:string};return [p.title,p.detail].filter(Boolean).join(": ");}
  catch{return "Request failed ("+res.status+")";}
}

/** Adopts a reviewed template (or starts blank) with an idempotency key, then opens the draft. */
export function AdoptButton({templateId,label}:{templateId:string|null;label:string}){
  const router=useRouter();
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const [idem]=useState(key);
  return <span>
    <button type="button" disabled={busy} onClick={async()=>{
      setBusy(true);setError("");
      const res=await fetch("/api/v1/me/public-record/drafts",{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":idem},
        body:JSON.stringify(templateId?{templateId}:{})});
      if(res.status===401){router.push("/api/auth/login?returnTo=/public-record/work");return;}
      if(!res.ok){setError(await problemText(res));setBusy(false);return;}
      const {draft}=await res.json() as {draft:{id:string}};
      router.push("/me/drafts/"+draft.id);
    }}>{busy?"Saving…":label}</button>
    {error && <span role="alert" style={{marginLeft:8,color:"#8a1c1c"}}>{error}</span>}
  </span>;
}

export interface EditableDraft {id:string;title:string;body:string;rangeStart:string|null;rangeEnd:string|null;feeCapUsd:number;electronicCopies:boolean;version:number}
const control={font:"inherit",padding:8,border:"1px solid #8d9896",borderRadius:6,width:"100%",boxSizing:"border-box" as const};
export function DraftEditor({initial}:{initial:EditableDraft}){
  const router=useRouter();
  const [d,setD]=useState(initial);
  const [status,setStatus]=useState("");
  const save=async()=>{
    setStatus("Saving…");
    const res=await fetch("/api/v1/me/public-record/drafts/"+d.id,{method:"PATCH",
      headers:{"Content-Type":"application/json","If-Match":`"v${d.version}"`},
      body:JSON.stringify({title:d.title,body:d.body,rangeStart:d.rangeStart||null,rangeEnd:d.rangeEnd||null,feeCapUsd:d.feeCapUsd,electronicCopies:d.electronicCopies})});
    if(!res.ok){setStatus(res.status===412?"This draft changed in another tab. Reload to see the latest version.":await problemText(res));return;}
    const body=await res.json() as {draft:EditableDraft};
    setD(body.draft);setStatus("Saved privately.");router.refresh();
  };
  return <form onSubmit={e=>{e.preventDefault();void save();}} style={{display:"grid",gap:12}}>
    <label>Title<input style={control} maxLength={250} value={d.title} onChange={e=>setD({...d,title:e.target.value})}/></label>
    <label>Records requested (identify existing records)<textarea style={control} rows={8} maxLength={20000} value={d.body} onChange={e=>setD({...d,body:e.target.value})}/></label>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12}}>
      <label>From<input style={control} type="date" value={d.rangeStart??""} onChange={e=>setD({...d,rangeStart:e.target.value||null})}/></label>
      <label>To<input style={control} type="date" value={d.rangeEnd??""} onChange={e=>setD({...d,rangeEnd:e.target.value||null})}/></label>
      <label>Fee ceiling (USD)<input style={control} type="number" min={0} max={10000} step={0.01} value={d.feeCapUsd} onChange={e=>setD({...d,feeCapUsd:Math.round(Number(e.target.value)*100)/100})}/></label>
    </div>
    <label style={{display:"flex",gap:8,alignItems:"center"}}><input type="checkbox" checked={d.electronicCopies} onChange={e=>setD({...d,electronicCopies:e.target.checked})}/>Request electronic copies</label>
    <div><button type="submit">Save draft</button> <span aria-live="polite">{status}</span></div>
  </form>;
}

const eventChoices:{type:string;label:string;payload?:Record<string,unknown>}[]=[
  {type:"filed",label:"I filed it with the agency (portal)",payload:{channel:"portal"}},
  {type:"filed",label:"I filed it with the agency (email)",payload:{channel:"email"}},
  {type:"acknowledged",label:"Agency acknowledged receipt"},
  {type:"clarification_requested",label:"Agency asked a clarifying question"},
  {type:"clarification_answered",label:"I answered the agency's question"},
  {type:"fee_estimate_received",label:"Agency sent a fee estimate"},
  {type:"fee_response_sent",label:"I agreed to pay fees (up to an amount)",payload:{decision:"accepted"}},
  {type:"fee_response_sent",label:"I narrowed the request because of fees",payload:{decision:"narrowed"}},
  {type:"fee_response_sent",label:"I declined the estimated fees",payload:{decision:"declined"}},
  {type:"fee_response_sent",label:"I asked for a fee waiver or reduction",payload:{decision:"waiver_requested"}},
  {type:"extension_notice",label:"Agency sent a written 10-day extension notice",payload:{workingDays:10,writtenNotice:true}},
  {type:"interim_release",label:"Agency released some records"},
  {type:"final_determination",label:"Final response: records released in full",payload:{outcome:"full_grant"}},
  {type:"final_determination",label:"Final response: partly released / withheld",payload:{outcome:"partial_grant"}},
  {type:"final_determination",label:"Final response: denied",payload:{outcome:"full_denial"}},
  {type:"final_determination",label:"Final response: no records found",payload:{outcome:"no_records"}},
  {type:"appeal_filed",label:"I filed an administrative appeal"},
  {type:"withdrawn",label:"I withdrew the request"}
];
export function EventRecorder({requestId,confirmation}:{requestId:string;confirmation:string}){
  const router=useRouter();
  const today=new Date().toISOString().slice(0,10);
  const [choice,setChoice]=useState(0),[on,setOn]=useState(today),[docRef,setDocRef]=useState(""),[status,setStatus]=useState("");
  const [confirmed,setConfirmed]=useState(false),[tracking,setTracking]=useState(""),[proof,setProof]=useState("");
  const [amount,setAmount]=useState("");
  const [idem,setIdem]=useState(key);
  const c=eventChoices[choice];
  const fingerprint=async(file:File|undefined)=>{
    if(!file){setProof("");return;}
    if(file.size>50*1024*1024){setStatus("That file is too large to fingerprint here.");return;}
    setProof(proofReference(await sha256Hex(await file.arrayBuffer())));
  };
  const submit=async()=>{
    setStatus("Recording…");
    const ref=proof||docRef.trim();
    const money=amount.trim()===""?undefined:Math.round(Number(amount)*100)/100;
    const payload={...(c.payload??{}),...(c.type==="acknowledged" && tracking.trim()?{agencyTrackingNumber:tracking.trim()}:{}),
      ...(c.type==="fee_estimate_received" && money!==undefined?{amountUsd:money}:{}),
      ...(c.type==="fee_response_sent" && c.payload?.decision==="accepted" && money!==undefined?{acceptedMaxUsd:money}:{})};
    const res=await fetch(`/api/v1/me/public-record/requests/${requestId}/events`,{method:"POST",
      headers:{"Content-Type":"application/json","Idempotency-Key":idem},
      body:JSON.stringify({type:c.type,occurredOn:on,payload,
        ...(ref?{assertedBy:proof?"requester":"agency_document",verification:"document_attached",evidenceRef:ref}:{}),
        ...(c.type==="filed"?{selfFilingConfirmation:confirmed?confirmation:""}:{})})});
    if(!res.ok){setStatus(await problemText(res));return;}
    setStatus("Recorded. It stays labeled as reported by you until a reviewer verifies agency evidence.");
    setIdem(key());setProof("");setConfirmed(false);setAmount("");router.refresh();
  };
  return <form onSubmit={e=>{e.preventDefault();void submit();}} style={{display:"grid",gap:10}}>
    <label>What happened?<select style={control} value={choice} onChange={e=>setChoice(Number(e.target.value))}>
      {eventChoices.map((x,i)=><option key={i} value={i}>{x.label}</option>)}</select></label>
    <label>Date it happened<input style={control} type="date" max={today} value={on} onChange={e=>setOn(e.target.value)}/></label>
    {(c.type==="fee_estimate_received" || (c.type==="fee_response_sent" && c.payload?.decision==="accepted")) &&
      <label>{c.type==="fee_estimate_received"?"Estimated fee (USD)":"Most you agree to pay (USD)"}
        <input style={control} type="number" min={0} step={0.01} value={amount} onChange={e=>setAmount(e.target.value)}/></label>}
    {c.type==="acknowledged" && <label>Agency tracking number (optional)<input style={control} maxLength={64} value={tracking} onChange={e=>setTracking(e.target.value)}/></label>}
    <label>Private receipt fingerprint (optional). The file is hashed in your browser and never uploaded.
      <input type="file" onChange={e=>void fingerprint(e.target.files?.[0])}/></label>
    {proof && <p style={{fontSize:13,wordBreak:"break-all"}}>Fingerprint: {proof}</p>}
    {!proof && <label>Agency document reference (optional, e.g. a letter number; no personal details)
      <input style={control} maxLength={160} pattern="[A-Za-z0-9:_.\-]*" value={docRef} onChange={e=>setDocRef(e.target.value)}/></label>}
    {c.type==="filed" && <label style={{display:"flex",gap:8,alignItems:"flex-start"}}>
      <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required/>{confirmation}</label>}
    <div><button type="submit">Record event</button> <span aria-live="polite">{status}</span></div>
  </form>;
}

/** Re-hash a receipt locally and compare with a stored fingerprint (tamper check). */
export function ProofCheck({reference}:{reference:string}){
  const [result,setResult]=useState("");
  return <label style={{fontSize:14}}>Check a receipt file against this fingerprint:{" "}
    <input type="file" onChange={async e=>{
      const f=e.target.files?.[0];if(!f)return;
      const r=checkProof(reference,await sha256Hex(await f.arrayBuffer()));
      setResult(r==="matches"?"Matches: the file is unchanged.":"Does not match: this is a different or modified file.");
    }}/> <span aria-live="polite">{result}</span></label>;
}

const GROUND_LABELS:Record<string,string>={search_adequacy:"The search may have missed records",exemptions:"Withholdings or redactions",
  no_records:"\"No records\" response",fees:"Fees or fee category",expedite:"Expedited processing denied",other:"Other reason"};
/** Builds an editable appeal letter locally; the participant files it themselves. */
export function AppealLetterBuilder({input,suggested}:{input:{agencyLabel:string|null;trackingNumber:string|null;requestTitle:string;determinationOn:string};suggested:string[]}){
  const [grounds,setGrounds]=useState<string[]>(suggested.length?suggested:["other"]);
  const [explanation,setExplanation]=useState("");
  const [copied,setCopied]=useState("");
  let text="";
  try{text=draftAppealLetter({...input,grounds:grounds as AppealGround[],explanation});}catch{text="";}
  return <div style={{display:"grid",gap:10}}>
    <fieldset><legend>Why are you appealing?</legend>
      {Object.keys(GROUND_LABELS).map(g=><label key={g} style={{display:"block"}}><input type="checkbox" checked={grounds.includes(g)}
        onChange={e=>setGrounds(e.target.checked?[...grounds,g]:grounds.filter(x=>x!==g))}/> {GROUND_LABELS[g]}</label>)}
    </fieldset>
    <label>Your explanation (optional)<textarea style={control} rows={4} maxLength={4000} value={explanation} onChange={e=>setExplanation(e.target.value)}/></label>
    {text && <><pre style={{whiteSpace:"pre-wrap",background:"#f4f6f5",padding:12,borderRadius:8,fontFamily:"inherit"}}>{text}</pre>
      <div><button type="button" onClick={async()=>{await navigator.clipboard.writeText(text);setCopied("Copied. Review it, then send it yourself as the agency's letter instructs.");}}>Copy letter</button> <span aria-live="polite">{copied}</span></div></>}
  </div>;
}

export function ReminderToggle({enabled}:{enabled:boolean}){
  const router=useRouter();
  const [on,setOn]=useState(enabled),[status,setStatus]=useState("");
  return <label style={{display:"flex",gap:8,alignItems:"center"}}><input type="checkbox" checked={on} onChange={async e=>{
    const next=e.target.checked;setOn(next);setStatus("Saving…");
    const res=await fetch("/api/v1/me/public-record/notifications",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({deadlineReminders:next})});
    setStatus(res.ok?"Saved.":await problemText(res));router.refresh();
  }}/>In-app reminders before estimated dates <span aria-live="polite" style={{color:"#465451"}}>{status}</span></label>;
}

/** Copy / download / print the exact request text. Nothing is sent anywhere. */
export function ExportPanel({result}:{result:{ready:true;text:string;filename:string}|{ready:false;problems:string[]}}){
  const [status,setStatus]=useState("");
  if(!result.ready)return <div><p>Before exporting, fix:</p><ul>{result.problems.map(p=><li key={p}>{p}</li>)}</ul></div>;
  const download=()=>{
    const url=URL.createObjectURL(new Blob([result.text],{type:"text/plain;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download=result.filename;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  };
  return <div>
    <div className="nonprint" style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:10}}>
      <button type="button" onClick={async()=>{await navigator.clipboard.writeText(result.text);setStatus("Copied.");}}>Copy text</button>
      <button type="button" onClick={download}>Download .txt</button>
      <button type="button" onClick={()=>window.print()}>Print or save as PDF</button>
      <span aria-live="polite">{status}</span>
    </div>
    <section className="print-only-record"><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontFamily:"inherit",background:"#f4f6f5",padding:12,borderRadius:8}}>{result.text}</pre></section>
  </div>;
}

/** Generic POST action button for editorial review pages. */
export function ActionButton({url,body,label}:{url:string;body:Record<string,unknown>;label:string}){
  const router=useRouter();
  const [status,setStatus]=useState("");
  return <span><button type="button" onClick={async()=>{
    setStatus("…");
    const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    setStatus(res.ok?"Done":await problemText(res));if(res.ok)router.refresh();
  }}>{label}</button> <span aria-live="polite">{status}</span></span>;
}

/** Private, scanned uploads for a request (TPR-28). Files never become public here. */
export function UploadPanel({requestId,uploads}:{requestId:string;uploads:{id:string;mime:string;sizeBytes:number;purpose:string;createdAt:string;sha256:string}[]}){
  const router=useRouter();
  const [status,setStatus]=useState(""),[purpose,setPurpose]=useState("correspondence");
  return <div>
    <label>Purpose <select style={control} value={purpose} onChange={e=>setPurpose(e.target.value)}>
      <option value="correspondence">Agency letter or email</option><option value="receipt">Filing receipt</option>
      <option value="released_record">Records the agency released</option></select></label>
    <label style={{display:"block",marginTop:8}}>File (PDF, text, PNG, JPEG, DOCX, XLSX; max 25 MB)
      <input type="file" accept=".pdf,.txt,.png,.jpg,.jpeg,.docx,.xlsx" onChange={async e=>{
        const f=e.target.files?.[0];if(!f)return;
        setStatus("Checking and storing privately…");
        const body=new FormData();body.set("file",f);body.set("purpose",purpose);
        const res=await fetch(`/api/v1/me/public-record/requests/${requestId}/uploads`,{method:"POST",body});
        setStatus(res.ok?"Stored privately after scanning.":await problemText(res));e.target.value="";router.refresh();
      }}/></label>
    <p aria-live="polite">{status}</p>
    <ul>{uploads.map(u=><li key={u.id}><a href={`/api/v1/me/public-record/requests/${requestId}/uploads/${u.id}`}>{u.purpose.replace(/_/g," ")} · {u.mime} · {Math.ceil(u.sizeBytes/1024)} KB</a>
      {" "}<small>sha256:{u.sha256.slice(0,12)}… · {u.createdAt.slice(0,10)}</small></li>)}</ul>
  </div>;
}

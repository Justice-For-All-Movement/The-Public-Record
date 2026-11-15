"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";

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
  {type:"filed",label:"I filed it with the agency",payload:{channel:"portal"}},
  {type:"acknowledged",label:"Agency acknowledged receipt"},
  {type:"clarification_requested",label:"Agency asked a clarifying question"},
  {type:"clarification_answered",label:"I answered the agency's question"},
  {type:"fee_estimate_received",label:"Agency sent a fee estimate"},
  {type:"fee_response_sent",label:"I responded about fees",payload:{decision:"accepted"}},
  {type:"extension_notice",label:"Agency sent a written 10-day extension notice",payload:{workingDays:10,writtenNotice:true}},
  {type:"interim_release",label:"Agency released some records"},
  {type:"final_determination",label:"Final response: records released in full",payload:{outcome:"full_grant"}},
  {type:"final_determination",label:"Final response: partly released / withheld",payload:{outcome:"partial_grant"}},
  {type:"final_determination",label:"Final response: denied",payload:{outcome:"full_denial"}},
  {type:"final_determination",label:"Final response: no records found",payload:{outcome:"no_records"}},
  {type:"appeal_filed",label:"I filed an administrative appeal"},
  {type:"withdrawn",label:"I withdrew the request"}
];
export function EventRecorder({requestId}:{requestId:string}){
  const router=useRouter();
  const today=new Date().toISOString().slice(0,10);
  const [choice,setChoice]=useState(0),[on,setOn]=useState(today),[docRef,setDocRef]=useState(""),[status,setStatus]=useState("");
  const [idem,setIdem]=useState(key);
  const submit=async()=>{
    const c=eventChoices[choice];
    setStatus("Recording…");
    const withDoc=docRef.trim().length>0;
    const res=await fetch(`/api/v1/me/public-record/requests/${requestId}/events`,{method:"POST",
      headers:{"Content-Type":"application/json","Idempotency-Key":idem},
      body:JSON.stringify({type:c.type,occurredOn:on,payload:c.payload??{},
        ...(withDoc?{assertedBy:"agency_document",verification:"document_attached",evidenceRef:docRef.trim()}:{})})});
    if(!res.ok){setStatus(await problemText(res));return;}
    setStatus("Recorded. It stays labeled as reported by you until a reviewer verifies agency evidence.");
    setIdem(key());router.refresh();
  };
  return <form onSubmit={e=>{e.preventDefault();void submit();}} style={{display:"grid",gap:10}}>
    <label>What happened?<select style={control} value={choice} onChange={e=>setChoice(Number(e.target.value))}>
      {eventChoices.map((c,i)=><option key={i} value={i}>{c.label}</option>)}</select></label>
    <label>Date it happened<input style={control} type="date" max={today} value={on} onChange={e=>setOn(e.target.value)}/></label>
    <label>Agency document reference (optional, e.g. a letter number; no personal details)
      <input style={control} maxLength={160} pattern="[A-Za-z0-9:_.\-]*" value={docRef} onChange={e=>setDocRef(e.target.value)}/></label>
    <div><button type="submit">Record event</button> <span aria-live="polite">{status}</span></div>
  </form>;
}

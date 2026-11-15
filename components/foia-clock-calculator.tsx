"use client";
import {useMemo,useState} from "react";
import {createFederalCalendar,isValidIsoDate} from "../lib/clock/federal-calendar";
import {computeFoiaClock,type ClockInput,type ReceiptBasis} from "../lib/clock/foia-clock";

const calendar=createFederalCalendar();
const control={font:"inherit",padding:8,border:"1px solid #8d9896",borderRadius:6} as const;
const field={display:"grid",gap:4,marginBottom:12} as const;
const opt=(v:string)=>v && isValidIsoDate(v)?v:null;
const statusText:Record<string,string>={
  unknown_receipt:"No date can be estimated without a filing or receipt date.",
  estimated:"Estimated determination date",
  estimate_range:"Estimated determination window (agency receipt unverified)",
  paused:"Clock paused while you answer the agency",
  alternative_timeframe:"Alternative timeframe",
  determination_recorded:"A determination has been recorded",
  disputed:"Records conflict — review needed",
  review_needed:"Review needed"
};

export default function FoiaClockCalculator(){
  const today=new Date().toISOString().slice(0,10);
  const [filedOn,setFiled]=useState("");
  const [receivedOn,setReceived]=useState("");
  const [basis,setBasis]=useState<ReceiptBasis>("agency_acknowledgment");
  const [tollStart,setTollStart]=useState("");
  const [tollEnd,setTollEnd]=useState("");
  const [tollKind,setTollKind]=useState<"fee"|"information">("fee");
  const [extDays,setExtDays]=useState(0);
  const [determinedOn,setDetermined]=useState("");
  const [adverse,setAdverse]=useState(false);
  const result=useMemo(()=>{
    try{
      const input:ClockInput={today,filedOn:opt(filedOn),receivedOn:opt(receivedOn),receiptBasis:opt(receivedOn)?basis:null,
        tolls:opt(tollStart)?[{kind:tollKind,requestedOn:tollStart,resolvedOn:opt(tollEnd)}]:[],
        extensions:extDays>0?[{kind:"unusual_circumstances",noticeOn:opt(receivedOn)??opt(filedOn)??today,workingDays:extDays,writtenNotice:true}]:[],
        determination:opt(determinedOn)?{on:determinedOn,adverse}:null};
      return {ok:true as const,value:computeFoiaClock(input,calendar)};
    }catch(e){return {ok:false as const,error:e instanceof Error?e.message:"Invalid dates"};}
  },[today,filedOn,receivedOn,basis,tollStart,tollEnd,tollKind,extDays,determinedOn,adverse]);
  const d=result.ok?result.value.determination:null;
  return <section aria-label="FOIA deadline estimate">
    <p>Nothing you enter leaves this browser tab.</p>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14}}>
      <label style={field}>Date you submitted<input style={control} type="date" value={filedOn} onChange={e=>setFiled(e.target.value)}/></label>
      <label style={field}>Date the agency received it (if known)<input style={control} type="date" value={receivedOn} onChange={e=>setReceived(e.target.value)}/></label>
      <label style={field}>Receipt evidence<select style={control} value={basis} onChange={e=>setBasis(e.target.value as ReceiptBasis)}>
        <option value="agency_acknowledgment">Agency acknowledgment</option><option value="agency_letter">Agency letter</option>
        <option value="portal_record">Portal record</option><option value="requester_estimate">My estimate</option></select></label>
      <label style={field}>Agency asked you a question on<input style={control} type="date" value={tollStart} onChange={e=>setTollStart(e.target.value)}/></label>
      <label style={field}>You answered on (blank if not yet)<input style={control} type="date" value={tollEnd} onChange={e=>setTollEnd(e.target.value)}/></label>
      <label style={field}>Question type<select style={control} value={tollKind} onChange={e=>setTollKind(e.target.value as "fee"|"information")}>
        <option value="fee">Fee clarification</option><option value="information">Clarifying the request</option></select></label>
      <label style={field}>Written extension notice (working days)<input style={control} type="number" min={0} max={30} value={extDays} onChange={e=>setExtDays(Math.max(0,Math.min(30,Number(e.target.value)||0)))}/></label>
      <label style={field}>Determination letter dated<input style={control} type="date" value={determinedOn} onChange={e=>setDetermined(e.target.value)}/></label>
      <label style={{...field,display:"flex",alignItems:"center",gap:8}}><input type="checkbox" checked={adverse} onChange={e=>setAdverse(e.target.checked)}/>Determination was adverse (denial, partial, no records, fee)</label>
    </div>
    <output aria-live="polite" style={{display:"block",background:"#fff",border:"1px solid #c4ceca",borderRadius:10,padding:18,marginTop:12}}>
      {!result.ok && <p role="alert">{result.error}</p>}
      {result.ok && d && <>
        <h2 style={{marginTop:0,fontSize:20}}>{statusText[d.status]}</h2>
        {d.dueOn && <p style={{fontSize:22,margin:"6px 0"}}>{d.dueOn}{d.dueLatestOn && d.dueLatestOn!==d.dueOn?` – ${d.dueLatestOn}`:""}</p>}
        {d.workingDaysCounted!==null && <p>Working days counted so far: {d.workingDaysCounted}{d.workingDaysPaused?` (paused ${d.workingDaysPaused})`:""}</p>}
        {d.estimatedDatePassed && <p>The estimated date has passed without a recorded determination. Consider contacting the agency&apos;s FOIA Public Liaison; this is not a finding that the agency acted improperly.</p>}
        {result.value.appeal.minimumWindowEndsOn && <p>Appeal: at least 90 days, i.e. through {result.value.appeal.minimumWindowEndsOn} at minimum. Follow the deadline and instructions in the letter.</p>}
        <ul>{result.value.notes.map(n=><li key={n}>{n}</li>)}</ul>
        <p style={{fontSize:14,color:"#465451"}}>{result.value.disclaimer}</p>
      </>}
    </output>
  </section>;
}

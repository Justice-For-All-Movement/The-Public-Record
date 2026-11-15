import {describe,expect,it} from "vitest";
import {createFederalCalendar} from "../lib/clock/federal-calendar";
import {computeFoiaClock} from "../lib/clock/foia-clock";
import {validateEvent,type LifecycleEvent,type LifecycleEventType,type LifecyclePayloads} from "../lib/lifecycle/events";
import {clockInputFromProjection,rebuildLifecycle} from "../lib/lifecycle/projection";

let seq=0;
function ev<T extends LifecycleEventType>(type:T,occurredOn:string,payload:LifecyclePayloads[T],over:Partial<LifecycleEvent>={}):LifecycleEvent {
  seq++;
  return {id:over.id??`evt-${String(seq).padStart(3,"0")}`,requestId:"req-001",type,occurredOn,
    recordedAt:over.recordedAt??new Date(Date.UTC(2026,0,1,0,seq)).toISOString(),assertedBy:"requester",
    verification:"self_reported",evidenceRef:null,causedBy:null,correctsEventId:null,payload,...over} as LifecycleEvent;
}
const verified={assertedBy:"reviewer" as const,verification:"reviewer_verified" as const,evidenceRef:"doc:fixture-ack"};
const shuffle=<T,>(a:T[])=>[...a].reverse().concat([]).sort((x,y)=>(JSON.stringify(x).length%3)-(JSON.stringify(y).length%3));

describe("lifecycle event validation",()=>{
  it("rejects unknown payload keys and reviewer verification without evidence",()=>{
    expect(()=>validateEvent(ev("filed","2026-01-02",{channel:"portal",requesterEmail:"x"} as never))).toThrow();
    expect(()=>validateEvent(ev("acknowledged","2026-01-05",{},{verification:"reviewer_verified"}))).toThrow(/reviewer/);
    expect(()=>validateEvent(ev("acknowledged","2026-01-05",{},{verification:"document_attached"}))).toThrow(/evidence/);
    expect(()=>validateEvent(ev("correction","2026-01-05",{reason:"x",retract:true}))).toThrow();
  });
});

describe("lifecycle projection",()=>{
  const filed=ev("filed","2026-01-02",{channel:"portal"});
  const ack=ev("acknowledged","2026-01-05",{agencyTrackingNumber:"FIX-2026-0001"},verified);
  const clar=ev("clarification_requested","2026-01-08",{},{assertedBy:"agency_document",verification:"document_attached",evidenceRef:"doc:fixture-clar"});
  const ans=ev("clarification_answered","2026-01-12",{},{causedBy:clar.id});
  const det=ev("final_determination","2026-02-20",{outcome:"partial_grant",statedAppealDeadline:null},{assertedBy:"agency_document",verification:"document_attached",evidenceRef:"doc:fixture-det"});
  const all=[filed,ack,clar,ans,det];

  it("is deterministic regardless of arrival order and idempotent for repeats",()=>{
    const a=rebuildLifecycle("req-001",all);
    const b=rebuildLifecycle("req-001",[...shuffle(all),ack,filed]);
    expect(b.status).toEqual(a.status);
    expect(b.facts).toEqual(a.facts);
    expect(b.history.filter(h=>h.state==="duplicate")).toHaveLength(2);
    expect(a.status).toMatchObject({stage:"determined",basisEventId:det.id,disputed:false});
    expect(a.status!.label).toBe("Determination issued: partial grant (agency document attached, not yet reviewed)");
    expect(a.facts).toMatchObject({filedOn:"2026-01-02",receivedOn:"2026-01-05",receiptVerification:"reviewer_verified",
      agencyTrackingNumber:"FIX-2026-0001",tolls:[{kind:"information",requestedOn:"2026-01-08",resolvedOn:"2026-01-12"}]});
  });
  it("never labels a requester report as agency-confirmed and uses it only as an estimate",()=>{
    const p=rebuildLifecycle("req-001",[filed,ev("acknowledged","2026-01-05",{})]);
    expect(p.status!.label).toBe("Received by agency (reported by the requester)");
    expect(p.status!.label).not.toMatch(/confirm/);
    expect(clockInputFromProjection(p,"2026-01-20")).toMatchObject({receivedOn:"2026-01-05",receiptBasis:"requester_estimate"});
  });
  it("does not let a later adoption hide a backdated filing",()=>{
    const p=rebuildLifecycle("req-001",[ev("adopted","2026-11-15",{templateId:"tpl-x",templateVersion:1}),filed]);
    expect(p.status!.stage).toBe("filed");
    expect(rebuildLifecycle("req-001",[ev("adopted","2026-11-15",{})]).status!.stage).toBe("adopted");
  });
  it("holds events whose cause has not arrived yet, then applies them",()=>{
    const early=rebuildLifecycle("req-001",[filed,ans]);
    expect(early.history.find(h=>h.event.id===ans.id)!.state).toBe("awaiting_cause");
    expect(early.status!.stage).toBe("filed");
    const later=rebuildLifecycle("req-001",[filed,ans,clar]);
    expect(later.history.find(h=>h.event.id===ans.id)!.state).toBe("applied");
  });
  it("keeps the original and shows the correction in history",()=>{
    const fix=ev("correction","2026-01-03",{reason:"Wrong date entered",retract:false,replacement:{occurredOn:"2026-01-03"}},{correctsEventId:filed.id});
    const p=rebuildLifecycle("req-001",[filed,ack,fix]);
    expect(p.facts.filedOn).toBe("2026-01-03");
    const original=p.history.find(h=>h.event.id===filed.id)!;
    expect(original).toMatchObject({state:"corrected",correctedBy:[fix.id]});
    expect(original.event.occurredOn).toBe("2026-01-02");
    expect(p.history.find(h=>h.event.id===fix.id)!.state).toBe("correction");
    const retract=ev("correction","2026-01-20",{reason:"Entered on the wrong request",retract:true},{correctsEventId:det.id,
      assertedBy:"agency_document",verification:"document_attached",evidenceRef:"doc:fixture-det"});
    const r=rebuildLifecycle("req-001",[...all,retract]);
    expect(r.facts.determination).toBeNull();
    expect(r.history.find(h=>h.event.id===det.id)!.state).toBe("retracted");
  });
  it("refuses a self-reported correction of reviewer-verified evidence",()=>{
    const bad=ev("correction","2026-01-06",{reason:"I disagree",retract:true},{correctsEventId:ack.id});
    const p=rebuildLifecycle("req-001",[filed,ack,bad]);
    expect(p.facts.receivedOn).toBe("2026-01-05");
    expect(p.conflicts.map(c=>c.kind)).toContain("insufficient_correction_authority");
  });
  it("flags conflicting outcomes and filing dates as disputed and suppresses the clock",()=>{
    const det2=ev("final_determination","2026-02-21",{outcome:"full_denial"});
    const p=rebuildLifecycle("req-001",[...all,det2]);
    expect(p.disputed).toBe(true);
    expect(p.status!.label).toMatch(/records conflict/);
    const clock=computeFoiaClock(clockInputFromProjection(p,"2026-03-01"),createFederalCalendar());
    expect(clock.determination.status).toBe("disputed");
    const twoDates=rebuildLifecycle("req-001",[filed,ev("filed","2026-01-09",{channel:"email"})]);
    expect(twoDates.conflicts.map(c=>c.kind)).toEqual(["competing_filing_dates"]);
  });
  it("allows a new determination after an appeal remand",()=>{
    const appeal=ev("appeal_filed","2026-03-01",{});
    const remand=ev("appeal_determination","2026-04-01",{outcome:"remanded"});
    const det2=ev("final_determination","2026-05-01",{outcome:"full_grant"});
    const p=rebuildLifecycle("req-001",[...all,appeal,remand,det2]);
    expect(p.disputed).toBe(false);
    expect(p.facts.determination!.outcome).toBe("full_grant");
  });
  it("detects conflicting reuse of an id and ignores events for other requests",()=>{
    const p=rebuildLifecycle("req-001",[filed,{...filed,occurredOn:"2026-01-04",recordedAt:"2026-02-01T00:00:00.000Z"},
      {...ack,id:"evt-other",requestId:"req-002"}]);
    expect(p.conflicts.map(c=>c.kind).sort()).toEqual(["conflicting_duplicate_id","event_for_other_request"]);
    expect(p.facts.filedOn).toBe("2026-01-02");
  });
  it("feeds verified receipt, tolls and adverse determinations into the clock",()=>{
    const p=rebuildLifecycle("req-001",all);
    const clock=computeFoiaClock(clockInputFromProjection(p,"2026-03-01"),createFederalCalendar());
    expect(clock.verificationLevel).toBe("evidenced");
    expect(clock.determination.status).toBe("determination_recorded");
    expect(clock.determination.workingDaysPaused).toBe(2);
    expect(clock.appeal).toMatchObject({status:"window_open",minimumWindowEndsOn:"2026-05-21"});
  });
});

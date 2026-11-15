import {describe,expect,it} from "vitest";
import {assertFeeResponseAllowed,feeStatus,FeeDecisionError} from "../lib/lifecycle/fees";
import {appealAssistance,draftAppealLetter} from "../lib/appeals/appeal-assistant";
import {rebuildLifecycle,clockInputFromProjection} from "../lib/lifecycle/projection";
import {computeFoiaClock} from "../lib/clock/foia-clock";
import {createFederalCalendar} from "../lib/clock/federal-calendar";
import type {LifecycleEvent,LifecycleEventType,LifecyclePayloads} from "../lib/lifecycle/events";

let n=0;
const ev=<T extends LifecycleEventType>(type:T,occurredOn:string,payload:LifecyclePayloads[T],over:Partial<LifecycleEvent>={}):LifecycleEvent=>
  ({id:`evt-${++n}`,requestId:"drf_fixture",type,occurredOn,recordedAt:`2026-01-01T00:00:${String(n).padStart(2,"0")}.000Z`,
    assertedBy:"requester",verification:"self_reported",evidenceRef:null,causedBy:null,correctsEventId:null,payload,...over} as LifecycleEvent);

describe("fee ceiling decisions (TPR-26)",()=>{
  const est=ev("fee_estimate_received","2026-01-10",{amountUsd:120});
  it("flags an above-ceiling estimate as awaiting the participant's decision",()=>{
    expect(feeStatus([est],25)).toMatchObject({state:"above_ceiling_awaiting_decision",latestEstimateUsd:120});
    expect(feeStatus([est],200).state).toBe("within_ceiling");
    expect(feeStatus([],25).state).toBe("no_estimate");
  });
  it("never records acceptance above the ceiling without an explicit covering maximum",()=>{
    const accept=(acceptedMaxUsd?:number)=>({type:"fee_response_sent" as const,payload:{decision:"accepted" as const,
      ...(acceptedMaxUsd===undefined?{}:{acceptedMaxUsd})}});
    expect(()=>assertFeeResponseAllowed([est],25,accept())).toThrow(FeeDecisionError);
    expect(()=>assertFeeResponseAllowed([est],25,accept(100))).toThrow(/above your ceiling/);
    expect(()=>assertFeeResponseAllowed([est],25,accept(120))).not.toThrow();
    expect(()=>assertFeeResponseAllowed([],25,accept(10))).toThrow(/estimate/);
    expect(()=>assertFeeResponseAllowed([est],25,{type:"fee_response_sent",payload:{decision:"narrowed"}})).not.toThrow();
    expect(()=>assertFeeResponseAllowed([est],200,accept())).not.toThrow();
    const after=ev("fee_response_sent","2026-01-12",{decision:"accepted",acceptedMaxUsd:120});
    expect(feeStatus([est,after],25)).toMatchObject({state:"accepted_explicitly"});
  });
});

describe("appeal and OGIS assistance (TPR-27)",()=>{
  const cal=createFederalCalendar();
  const filed=ev("filed","2026-01-02",{channel:"portal"});
  const deny=ev("final_determination","2026-03-02",{outcome:"no_records",statedAppealDeadline:null});
  const assist=(events:LifecycleEvent[])=>{
    const p=rebuildLifecycle("drf_fixture",events);
    return appealAssistance(p,computeFoiaClock(clockInputFromProjection(p,"2026-03-10"),cal));
  };
  it("offers options only after an adverse determination, with hedged timing",()=>{
    expect(assist([filed]).eligible).toBe(false);
    expect(assist([filed,ev("final_determination","2026-03-02",{outcome:"full_grant"})]).eligible).toBe(false);
    const a=assist([filed,deny]);
    expect(a).toMatchObject({eligible:true,suggestedGrounds:["no_records","search_adequacy"],alreadyAppealed:false});
    expect(a.windowText).toMatch(/at least 90 days.*2026-05-31.*follow the deadline/);
    expect(a.resources.map(r=>new URL(r.url).hostname)).toEqual(["www.justice.gov","www.archives.gov","www.foia.gov"]);
  });
  it("preserves the original denial when an appeal is recorded",()=>{
    const appeal=ev("appeal_filed","2026-03-20",{});
    const result=ev("appeal_determination","2026-04-20",{outcome:"affirmed"});
    const p=rebuildLifecycle("drf_fixture",[filed,deny,appeal,result]);
    expect(p.facts.determination).toMatchObject({outcome:"no_records",on:"2026-03-02"});
    expect(p.history.map(h=>h.event.type)).toEqual(["filed","final_determination","appeal_filed","appeal_determination"]);
    expect(p.status!.stage).toBe("appeal_decided");
  });
  it("drafts an editable letter with placeholders and no false certainty",()=>{
    const text=draftAppealLetter({agencyLabel:null,trackingNumber:"FIX-2026-0001",requestTitle:"Fictional memos",
      determinationOn:"2026-03-02",grounds:["no_records"],explanation:""});
    expect(text).toMatch(/no\. FIX-2026-0001/);
    expect(text).toMatch(/\[Your name\]/);
    expect(text).toMatch(/use the address in your determination letter/);
    expect(text).not.toMatch(/guarantee|will win|must release|deadline is/i);
    expect(()=>draftAppealLetter({agencyLabel:null,trackingNumber:null,requestTitle:"x",determinationOn:"2026-03-02",grounds:[],explanation:""})).toThrow();
  });
});

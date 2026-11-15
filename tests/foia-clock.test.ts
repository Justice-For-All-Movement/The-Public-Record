import {describe,expect,it} from "vitest";
import {createFederalCalendar} from "../lib/clock/federal-calendar";
import {computeFoiaClock,type ClockInput} from "../lib/clock/foia-clock";

const cal=createFederalCalendar();
const base:ClockInput={today:"2026-01-20",filedOn:"2026-01-02",receivedOn:"2026-01-02",receiptBasis:"agency_acknowledgment"};
const run=(over:Partial<ClockInput>)=>computeFoiaClock({...base,...over},cal);

describe("FOIA determination clock — legal test matrix",()=>{
  it("counts 20 working days after evidenced receipt, skipping weekends and MLK Day",()=>{
    const r=run({});
    expect(r.verificationLevel).toBe("evidenced");
    expect(r.determination).toMatchObject({status:"estimated",clockStartOn:"2026-01-02",dueOn:"2026-02-02",workingDaysCounted:11});
    expect(r.elapsed.calendarDaysSinceFiling).toBe(18);
  });
  it("skips Thanksgiving and returns a range when agency receipt is unknown",()=>{
    expect(run({filedOn:"2026-11-20",receivedOn:"2026-11-20",today:"2026-11-30"}).determination.dueOn).toBe("2026-12-21");
    const r=run({receivedOn:null,receiptBasis:null});
    expect(r.verificationLevel).toBe("approximate");
    expect(r.determination).toMatchObject({status:"estimate_range",clockStartOn:"2026-01-02",
      clockStartLatestOn:"2026-01-16",dueOn:"2026-02-02",dueLatestOn:"2026-02-17"});
  });
  it("shows no date at all without a filing or receipt date",()=>{
    const r=run({filedOn:null,receivedOn:null,receiptBasis:null});
    expect(r.verificationLevel).toBe("unknown");
    expect(r.determination).toMatchObject({status:"unknown_receipt",dueOn:null,estimatedDatePassed:false});
  });
  it("labels a requester-estimated receipt as approximate",()=>{
    expect(run({receiptBasis:"requester_estimate"}).verificationLevel).toBe("approximate");
  });
  it("pauses for a fee clarification and resumes after the response",()=>{
    const r=run({tolls:[{kind:"fee",requestedOn:"2026-01-08",resolvedOn:"2026-01-09"}],today:"2026-02-01"});
    expect(r.determination.dueOn).toBe("2026-02-03");
    expect(r.determination.workingDaysPaused).toBe(1);
    const open=run({tolls:[{kind:"fee",requestedOn:"2026-01-08",resolvedOn:null}]});
    expect(open.determination).toMatchObject({status:"paused",dueOn:null});
  });
  it("tolls only once for information requests",()=>{
    const r=run({tolls:[{kind:"information",requestedOn:"2026-01-06",resolvedOn:"2026-01-08"},
      {kind:"information",requestedOn:"2026-01-13",resolvedOn:"2026-01-20"}],today:"2026-01-21"});
    expect(r.determination.dueOn).toBe("2026-02-04");
    expect(r.notes.join(" ")).toMatch(/second information request does not toll/);
  });
  it("ignores an open pause requested after the estimated date",()=>{
    const r=run({tolls:[{kind:"fee",requestedOn:"2026-02-10",resolvedOn:null}],today:"2026-02-12"});
    expect(r.determination).toMatchObject({status:"estimated",dueOn:"2026-02-02",estimatedDatePassed:true});
  });
  it("applies an unusual-circumstances extension only with written notice and up to 10 days",()=>{
    const ext=(workingDays:number,writtenNotice=true)=>run({extensions:[{kind:"unusual_circumstances",noticeOn:"2026-01-20",workingDays,writtenNotice}]});
    expect(ext(10).determination).toMatchObject({status:"estimated",dueOn:"2026-02-17",extensionWorkingDays:10});
    expect(ext(10,false).determination).toMatchObject({dueOn:"2026-02-02",extensionWorkingDays:0});
    expect(ext(15).determination).toMatchObject({status:"alternative_timeframe",dueOn:null});
    const agreed=run({extensions:[{kind:"alternative_timeframe",agreedOn:"2026-06-30"}]});
    expect(agreed.determination).toMatchObject({status:"alternative_timeframe",dueOn:"2026-06-30"});
  });
  it("starts a misrouted request's clock no later than 10 working days after first designated receipt",()=>{
    const r=run({receivedOn:"2026-02-02",firstDesignatedReceiptOn:"2026-01-02",today:"2026-02-03"});
    expect(r.determination.clockStartOn).toBe("2026-01-16");
    expect(r.determination.dueOn).toBe("2026-02-17");
  });
  it("marks a passed estimate neutrally and stops counting once a determination is recorded",()=>{
    const late=run({today:"2026-03-02"});
    expect(late.determination).toMatchObject({status:"estimated",estimatedDatePassed:true});
    const done=run({today:"2026-03-02",determination:{on:"2026-02-20",adverse:false}});
    expect(done.determination).toMatchObject({status:"determination_recorded",estimatedDatePassed:false,workingDaysCounted:33});
    expect(done.appeal.status).toBe("not_applicable");
  });
  it("shows no date for disputed records",()=>{
    expect(run({disputed:true}).determination).toMatchObject({status:"disputed",dueOn:null});
  });
  it("computes expedited-decision and appeal windows without claiming a final deadline",()=>{
    expect(run({expedited:{requestedOn:"2026-01-02",decidedOn:null}}).expedited).toEqual({decisionDueOn:"2026-01-12",status:"pending"});
    const adverse=run({today:"2026-03-10",determination:{on:"2026-03-02",adverse:true,statedAppealDeadline:"2026-04-01"}});
    expect(adverse.appeal).toMatchObject({status:"window_open",minimumWindowEndsOn:"2026-05-31",statedDeadline:"2026-04-01"});
    expect(adverse.notes.join(" ")).toMatch(/earlier than the 90-day statutory minimum/);
    const appealed=run({today:"2026-04-02",determination:{on:"2026-03-02",adverse:true},
      appeal:{filedOn:"2026-03-31",receivedOn:"2026-04-01",decidedOn:null}});
    expect(appealed.appeal).toMatchObject({status:"appeal_filed",decisionDueOn:"2026-04-29"});
    expect(run({today:"2026-06-01",determination:{on:"2026-03-02",adverse:true}}).appeal.status).toBe("minimum_window_passed");
  });
  it("never states or implies a legal violation",()=>{
    const scenarios=[run({today:"2026-12-01"}),run({disputed:true}),run({receivedOn:null,receiptBasis:null,today:"2026-12-01"}),
      run({today:"2026-12-01",determination:{on:"2026-11-02",adverse:true}})];
    for(const r of scenarios)expect(JSON.stringify(r)).not.toMatch(/illegal|unlawful|violat|overdue|breach/i);
    expect(scenarios[0].disclaimer).toMatch(/not legal advice/);
  });
  it("rejects malformed and impossible inputs",()=>{
    expect(()=>run({receivedOn:"2026-02-30"})).toThrow();
    expect(()=>run({filedOn:"2026-02-01"})).toThrow(/future/);
    expect(()=>run({tolls:[{kind:"fee",requestedOn:"2026-01-09",resolvedOn:"2026-01-08"}]})).toThrow();
    expect(()=>run({receiptBasis:null})).toThrow(/basis/);
  });
});

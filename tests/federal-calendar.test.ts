import {describe,expect,it} from "vitest";
import {addWorkingDays,createFederalCalendar,federalHolidays,workingDaysBetween} from "../lib/clock/federal-calendar";

describe("federal legal public holidays (5 U.S.C. 6103)",()=>{
  it("matches the published 2026 schedule including observed Independence Day",()=>{
    expect(federalHolidays(2026).map(h=>h.date)).toEqual([
      "2026-01-01","2026-01-19","2026-02-16","2026-05-25","2026-06-19","2026-07-03",
      "2026-09-07","2026-10-12","2026-11-11","2026-11-26","2026-12-25"]);
    expect(federalHolidays(2026).find(h=>h.date==="2026-07-03")).toMatchObject({observed:true,name:"Independence Day"});
  });
  it("moves Saturday holidays to Friday, including across a year boundary",()=>{
    expect(federalHolidays(2021).map(h=>h.date)).toContain("2021-12-31");
    expect(federalHolidays(2022).map(h=>h.date)).not.toContain("2022-01-01");
    const y2027=federalHolidays(2027).map(h=>h.date);
    expect(y2027).toEqual(expect.arrayContaining(["2027-06-18","2027-07-05","2027-12-24","2027-12-31"]));
    expect(y2027).toHaveLength(12);
  });
  it("moves Sunday holidays to Monday and starts Juneteenth in 2021",()=>{
    expect(federalHolidays(2023).map(h=>h.date)).toEqual(expect.arrayContaining(["2023-01-02","2023-11-10","2023-06-19"]));
    expect(federalHolidays(2022).map(h=>h.date)).toContain("2022-12-26");
    expect(federalHolidays(2020).some(h=>h.name.startsWith("Juneteenth"))).toBe(false);
  });
  it("counts working days and honours reviewed additional closures only with a source",()=>{
    const cal=createFederalCalendar();
    expect(cal.isWorkingDay("2026-11-26")).toBe(false);
    expect(cal.closureReason("2026-11-28")).toBe("Saturday");
    expect(addWorkingDays(cal,"2026-11-20",20)).toBe("2026-12-21");
    expect(workingDaysBetween(cal,"2026-11-20","2026-12-21")).toBe(20);
    const extra=createFederalCalendar([{date:"2026-12-24",reason:"Fictional executive closure (test)",sourceUrl:"https://example.gov/order"}]);
    expect(extra.isWorkingDay("2026-12-24")).toBe(false);
    expect(()=>createFederalCalendar([{date:"2026-12-24",reason:"x",sourceUrl:"http://example.gov"}])).toThrow();
    expect(()=>cal.isWorkingDay("2026-02-30")).toThrow();
  });
});

import {describe,expect,it,vi} from "vitest";
import {NOT_ABSENCE,resolvePublicRecords} from "../lib/research/archive-resolver";
import {createFixtureArchiveAdapter} from "../lib/integrations/archive-fixture";
import {createPublicArchiveHttpAdapter} from "../lib/integrations/foia-archive-http";
import {GET} from "../app/api/v1/public-record/records/search/route";
import {loadConfig,resetConfigForTests} from "../lib/server/config";
import {req} from "./helpers/http";

const fixture={adapter:"fixture" as const,synthetic:true};
const absence=/don't exist|do not exist|never released|no records exist/i;
describe("FOIA Aggregator resolver",()=>{
  it("returns contract-checked matches with provenance and holding status",async()=>{
    const r=await resolvePublicRecords("facilities modernization",createFixtureArchiveAdapter(),fixture);
    expect(r.state).toBe("matches");
    expect(r.records.map(x=>[x.id,x.holding])).toEqual([["fixture-arch-0001","archived_copy_with_hash"],["fixture-arch-0002","indexed_link_only"]]);
    expect(r.provenance).toMatchObject({adapter:"fixture",contractVersion:"public-archive-search/v1",coverage:"partial",synthetic:true});
    expect(r.exhaustive).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/fictional/);
    expect(r.warnings.join(" ")).toMatch(/index links only/);
  });
  it("never presents a miss, outage, bad contract or missing configuration as absence of records",async()=>{
    const outcomes=await Promise.all([
      resolvePublicRecords("nonexistent topic zzz",createFixtureArchiveAdapter(),fixture),
      resolvePublicRecords("records",{searchPublicRecords:async()=>{throw new Error("offline");}},{adapter:"http",synthetic:false}),
      resolvePublicRecords("records",{searchPublicRecords:async()=>({html:"<p>blocked</p>"})},{adapter:"http",synthetic:false}),
      resolvePublicRecords("records",null,null)
    ]);
    expect(outcomes.map(o=>o.state)).toEqual(["no_matches_in_indexed_portion","unavailable","incompatible_contract","not_configured"]);
    for(const o of outcomes){
      expect(o.records).toEqual([]);
      expect(o.warnings.join(" ")).toContain(NOT_ABSENCE);
      expect(o.warnings.join(" ").split(NOT_ABSENCE).join("")).not.toMatch(absence);
      expect(o.fallback.length).toBeGreaterThan(0);
    }
  });
  it("rejects too-short or oversized queries without calling upstream",async()=>{
    const adapter={searchPublicRecords:vi.fn()};
    expect((await resolvePublicRecords("ab",adapter,fixture)).state).toBe("invalid_query");
    expect((await resolvePublicRecords("x".repeat(301),adapter,fixture)).state).toBe("invalid_query");
    expect(adapter.searchPublicRecords).not.toHaveBeenCalled();
  });
  it("uses a pinned HTTPS endpoint, sends only the query, and fails closed on HTML",async()=>{
    const fetcher=vi.fn(async(url:unknown,init?:RequestInit)=>{
      const u=new URL(String(url));
      expect([...u.searchParams.keys()]).toEqual(["q","limit"]);
      expect(init?.credentials).toBe("omit");
      return new Response("<html></html>",{headers:{"content-type":"text/html"}});
    });
    const adapter=createPublicArchiveHttpAdapter({endpoint:"https://archive.example.org/api/public-archive/v1/search"},fetcher as unknown as typeof fetch);
    // An HTML page is treated as the archive being unavailable, never as "no records".
    expect((await resolvePublicRecords("records",adapter,{adapter:"http",synthetic:false})).state).toBe("unavailable");
    expect(()=>createPublicArchiveHttpAdapter({endpoint:"http://archive.example.org/search"})).toThrow();
  });
  it("serves the public API from configuration and never uses fixtures in production",async()=>{
    resetConfigForTests(loadConfig({NODE_ENV:"test",FOIA_AGGREGATOR_FIXTURES:"true"}));
    const ok=await (await GET(req("/api/v1/public-record/records/search?q=retention%20guidance"))).json();
    expect(ok).toMatchObject({state:"matches",provenance:{adapter:"fixture",synthetic:true}});
    expect((await GET(req("/api/v1/public-record/records/search?q=a"))).status).toBe(400);
    resetConfigForTests(loadConfig({NODE_ENV:"production",FOIA_AGGREGATOR_FIXTURES:"true"}));
    expect((await (await GET(req("/api/v1/public-record/records/search?q=retention"))).json()).state).toBe("not_configured");
    resetConfigForTests();
  });
});

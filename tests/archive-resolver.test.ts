import {describe,expect,it,vi} from "vitest";
import upstreamPage from "../fixtures/aggregator/fc13-catalog-page.upstream-fixture.json";
import {NOT_ABSENCE,resolvePublicRecords} from "../lib/research/archive-resolver";
import {createFixtureCatalogSource} from "../lib/integrations/archive-fixture";
import {CatalogContractError,createHttpCatalogSource,parseCatalogRecord,parseRecordsPage,createStaticCatalogSource} from "../lib/integrations/foia-catalog-export";
import {GET} from "../app/api/v1/public-record/records/search/route";
import {loadConfig,resetConfigForTests} from "../lib/server/config";
import {req} from "./helpers/http";

const fixture={adapter:"fixture" as const,synthetic:true};
const live={adapter:"http" as const,synthetic:false};
const absence=/don't exist|do not exist|never released|no records exist/i;
const manifest=(snapshot:string,records:number,extra:Record<string,unknown>={})=>({schema_version:"foia-catalog-export/1",snapshot_id:snapshot,
  generated_at:"2026-11-15T00:00:00+00:00",counts:{records,archived:0,metadata_only:records,text_indexed:0,agencies:1,sources:1},...extra});
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});

describe("FC-13 catalog contract (foia-catalog-export/1)",()=>{
  it("parses the upstream golden page and projects only known public fields",()=>{
    const page=parseRecordsPage(upstreamPage,upstreamPage.snapshot_id);
    expect(page.records.map(r=>[r.recordId,r.preservation.status,!!r.preservation.sha256])).toEqual([
      ["rec_9100ac0214caf5052eeef85e","archived",true],["rec_3b297e1bb6e04c5293ca5d2d","metadata_only",false]]);
    const withExtra=parseCatalogRecord({...upstreamPage.records[0],storage_key:"b2://private/key",future_field:"x"});
    expect(JSON.stringify(withExtra)).not.toMatch(/storage_key|b2:|future_field/);
  });
  it("rejects wrong schema versions, mismatched snapshots and malformed ids",()=>{
    expect(()=>parseRecordsPage({...upstreamPage,schema_version:"foia-catalog-export/2"},upstreamPage.snapshot_id)).toThrow(CatalogContractError);
    expect(()=>parseRecordsPage(upstreamPage,"snap_other")).toThrow(CatalogContractError);
    expect(()=>parseCatalogRecord({...upstreamPage.records[0],record_id:"123"})).toThrow(CatalogContractError);
    expect(parseCatalogRecord({...upstreamPage.records[0],url:"http://insecure.example.gov/a.pdf"})).toBeNull();
  });
  it("pages a pinned HTTPS origin without sending the search text, restarting on 409 and caching per snapshot",async()=>{
    const calls:string[]=[];
    let snapshot="snap_a",first=true;
    const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
      const u=new URL(url);calls.push(u.pathname+u.search);
      expect(init?.credentials).toBe("omit");expect(init?.redirect).toBe("error");
      if(u.pathname.endsWith("/manifest"))return json(manifest(snapshot,2));
      if(first && u.searchParams.get("cursor")){first=false;snapshot="snap_b";return json({detail:"snapshot changed"},409);}
      const rec=(i:number)=>({...upstreamPage.records[0],record_id:"rec_"+String(i).repeat(24).slice(0,24),title:"Contract "+i});
      return json(u.searchParams.get("cursor")
        ?{schema_version:"foia-catalog-export/1",snapshot_id:snapshot,records:[rec(2)],next_cursor:null}
        :{schema_version:"foia-catalog-export/1",snapshot_id:snapshot,records:[rec(1)],next_cursor:"c1"});
    });
    let t=0;
    const source=createHttpCatalogSource({baseUrl:"https://archive.example.org",fetcher:fetcher as unknown as typeof fetch,now:()=>t});
    const r=await resolvePublicRecords("contract",source,live);
    expect(r.state).toBe("matches");
    expect(r.provenance).toMatchObject({snapshotId:"snap_b",catalogRecords:2,searchedRecords:2,contractVersion:"foia-catalog-export/1"});
    expect(calls.every(c=>!/contract/i.test(c))).toBe(true);
    const before=calls.length;
    await resolvePublicRecords("contract",source,live);
    expect(calls.length).toBe(before); // cached within TTL
    t=11*60000;
    await resolvePublicRecords("contract",source,live);
    expect(calls.length).toBe(before+1); // manifest only: same snapshot reuses the index
    expect(()=>createHttpCatalogSource({baseUrl:"http://archive.example.org"})).toThrow();
  });
  it("reports a bounded, partial search when the catalog is larger than the cap",async()=>{
    const fetcher=vi.fn(async(url:string)=>{
      const u=new URL(url);
      if(u.pathname.endsWith("/manifest"))return json(manifest("snap_big",900));
      return json({schema_version:"foia-catalog-export/1",snapshot_id:"snap_big",records:[upstreamPage.records[0]],next_cursor:"more"});
    });
    const r=await resolvePublicRecords("contract",createHttpCatalogSource({baseUrl:"https://archive.example.org",maxRecords:1,fetcher:fetcher as unknown as typeof fetch}),live);
    expect(r.warnings.join(" ")).toMatch(/Only the first 1 of 900 catalog entries were searched/);
  });
});

describe("FOIA Aggregator resolver",()=>{
  it("returns matches with provenance and preservation status from the synthetic catalog",async()=>{
    const r=await resolvePublicRecords("facilities modernization",createFixtureCatalogSource(),fixture);
    expect(r.state).toBe("matches");
    expect(r.records.map(x=>x.holding)).toEqual(["archived_copy_with_hash","indexed_link_only"]);
    expect(r.records[1].sha256).toBeNull();
    expect(r.provenance).toMatchObject({adapter:"fixture",contractVersion:"foia-catalog-export/1",synthetic:true});
    expect(r.exhaustive).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/fictional/);
  });
  it("never presents a miss, empty catalog, outage, bad contract or missing configuration as absence of records",async()=>{
    const empty=createStaticCatalogSource(manifest("snap_empty",0,{archive:{archive_connected:false}}),
      [{schema_version:"foia-catalog-export/1",snapshot_id:"snap_empty",records:[],next_cursor:null}]);
    const outcomes=await Promise.all([
      resolvePublicRecords("nonexistent topic zzz",createFixtureCatalogSource(),fixture),
      resolvePublicRecords("records",empty,live),
      resolvePublicRecords("records",{loadIndex:async()=>{throw new Error("offline");}},live),
      resolvePublicRecords("records",{loadIndex:async()=>{throw new CatalogContractError();}},live),
      resolvePublicRecords("records",null,null)
    ]);
    expect(outcomes.map(o=>o.state)).toEqual(["no_matches_in_indexed_portion","no_matches_in_indexed_portion","unavailable","incompatible_contract","not_configured"]);
    expect(outcomes[1].warnings.join(" ")).toMatch(/currently empty.*storage is not connected/);
    for(const o of outcomes){
      expect(o.records).toEqual([]);
      expect(o.warnings.join(" ")).toContain(NOT_ABSENCE);
      expect(o.warnings.join(" ").split(NOT_ABSENCE).join("")).not.toMatch(absence);
      expect(o.fallback.length).toBeGreaterThan(0);
    }
  });
  it("rejects too-short or oversized queries without loading the catalog",async()=>{
    const source={loadIndex:vi.fn()};
    expect((await resolvePublicRecords("ab",source,fixture)).state).toBe("invalid_query");
    expect((await resolvePublicRecords("x".repeat(301),source,fixture)).state).toBe("invalid_query");
    expect(source.loadIndex).not.toHaveBeenCalled();
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

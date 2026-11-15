import {createHash} from "node:crypto";
import {describe,expect,it} from "vitest";
import {buildSelfFilingGuide,SELF_FILING_CONFIRMATION} from "../lib/filing/self-filing-guide";
import {filingRegistry} from "../lib/filing/registry";
import {checkProof,isProofReference,proofReference,sha256Hex} from "../lib/filing/proof-fingerprint";
import {rebuildLifecycle} from "../lib/lifecycle/projection";

const PORTAL="0f6c1d2e-3a4b-4c5d-8e9f-a0b1c2d3e4f5",EMAIL="1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
describe("self-filing guide (TPR-21)",()=>{
  const reg=filingRegistry("preview");
  it("links only to the reviewed official destination and never submits",()=>{
    const g=buildSelfFilingGuide(PORTAL,reg);
    expect(g.status).toBe("ready");
    const links=g.steps.flatMap(s=>s.link?[s.link.href]:[]);
    expect(links).toEqual(["https://agency.example.org/foia/how-to-file","https://requests.example.org/foia/new"]);
    expect(g.steps.find(s=>s.id==="file")!.detail).toMatch(/will not submit it for you/);
    expect(g.confirmation).toBe(SELF_FILING_CONFIRMATION);
    const mail=buildSelfFilingGuide(EMAIL,reg);
    expect(mail.steps.find(s=>s.id==="file")!.link!.href).toBe("mailto:foia@agency.example.org");
  });
  it("falls back to FOIA.gov for unknown, stale or tampered routes",()=>{
    expect(buildSelfFilingGuide(null,reg).status).toBe("no_verified_route");
    const stale=buildSelfFilingGuide(PORTAL,reg,new Date(Date.now()+120*86400000));
    expect(stale.status).toBe("needs_verification");
    const tampered={...reg,routes:reg.routes.map(r=>({...r,channel:{kind:"portal" as const,portalUrl:"https://requests.example.org.attacker.test/new"}}))};
    const g=buildSelfFilingGuide(PORTAL,tampered);
    expect(g.status).toBe("no_verified_route");
    for(const x of [stale,g])expect(x.steps.flatMap(s=>s.link?[s.link.href]:[])).toEqual(["https://www.foia.gov/how-to.html"]);
  });
  it("loads no synthetic routes in production",()=>{
    expect(filingRegistry("production").routes).toEqual([]);
    expect(buildSelfFilingGuide(PORTAL,filingRegistry("production")).status).toBe("no_verified_route");
  });
});

describe("private proof fingerprints (TPR-22)",()=>{
  it("hashes locally and detects a modified receipt",async()=>{
    const bytes=new TextEncoder().encode("Synthetic portal confirmation #FIX-0001");
    const hex=await sha256Hex(bytes.buffer as ArrayBuffer);
    expect(hex).toBe(createHash("sha256").update(bytes).digest("hex"));
    const ref=proofReference(hex);
    expect(isProofReference(ref)).toBe(true);
    expect(checkProof(ref,hex)).toBe("matches");
    const changed=await sha256Hex(new TextEncoder().encode("Synthetic portal confirmation #FIX-0002").buffer as ArrayBuffer);
    expect(checkProof(ref,changed)).toBe("does_not_match");
    expect(checkProof(null,hex)).toBe("no_fingerprint");
    expect(()=>proofReference("abc")).toThrow();
  });
  it("labels a fingerprinted filing as unreviewed, never agency-confirmed",()=>{
    const ref=proofReference("a".repeat(64));
    const p=rebuildLifecycle("drf_fixture",[{id:"evt-1",requestId:"drf_fixture",type:"filed",occurredOn:"2026-01-02",
      recordedAt:"2026-01-02T10:00:00.000Z",assertedBy:"requester",verification:"document_attached",evidenceRef:ref,
      causedBy:null,correctsEventId:null,payload:{channel:"portal"}}]);
    expect(p.status!.label).toBe("Filed (document attached, not yet reviewed)");
    expect(p.status!.label).not.toMatch(/confirm|verified/i);
  });
});

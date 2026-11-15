import {describe,expect,it} from "vitest";
import {effectiveConsent,type ConsentEvent} from "../lib/audit/consent";
import {validateAuditEntry} from "../lib/audit/audit-log";
import {safeLogLine} from "../lib/server/log";

const e=(id:string,scope:ConsentEvent["scope"],action:ConsentEvent["action"],t:string):ConsentEvent=>
  ({id,objectId:"obj-1",scope,action,recordedAt:t});
describe("current effective consent",()=>{
  it("follows the latest event, not any historical grant",()=>{
    const events=[e("1","web_publication","granted","2026-01-01T00:00:00Z"),e("2","web_publication","revoked","2026-01-02T00:00:00Z")];
    expect(effectiveConsent(events,"obj-1","web_publication")).toMatchObject({granted:false,basisEventId:"2"});
    expect(effectiveConsent([...events,e("3","web_publication","granted","2026-01-03T00:00:00Z")],"obj-1","web_publication").granted).toBe(true);
    expect(effectiveConsent([],"obj-1","web_publication")).toMatchObject({granted:false,basisEventId:null});
  });
  it("requires current web consent before distributed replication counts",()=>{
    const events=[e("1","distributed_replication","granted","2026-01-01T00:00:00Z")];
    expect(effectiveConsent(events,"obj-1","distributed_replication").granted).toBe(false);
    expect(effectiveConsent([...events,e("2","web_publication","granted","2026-01-01T00:00:00Z")],"obj-1","distributed_replication").granted).toBe(true);
  });
});
describe("privacy-safe audit and logs",()=>{
  it("rejects free text and malformed fingerprints in audit entries",()=>{
    const ok={owner:"a",actor:"a",action:"draft_created" as const,objectKind:"request_draft" as const,objectId:"draft-1"};
    expect(()=>validateAuditEntry(ok)).not.toThrow();
    expect(()=>validateAuditEntry({...ok,objectId:"Jane Doe's request about <x>"})).toThrow();
    expect(()=>validateAuditEntry({...ok,sha256:"abc"})).toThrow();
    expect(()=>validateAuditEntry({...ok,action:"anything" as never})).toThrow();
  });
  it("drops unknown keys and redacts tokens, emails and connection strings",()=>{
    const line=JSON.parse(safeLogLine({event:"login",reason:"user jane@example.org token eyJhbGciOiJSUzI1NiJ9.x postgresql://u:p@h/db",
      body:"draft text",subject:"fake|ada"}));
    expect(line.body).toBeUndefined();expect(line.subject).toBeUndefined();
    expect(line.reason).not.toMatch(/jane@|eyJhbGci|postgresql:/);
  });
});

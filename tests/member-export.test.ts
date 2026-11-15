import {describe,expect,it} from "vitest";
import {exportMemberDraft} from "../lib/templates/member-export";
import {publishedTemplates} from "../lib/adoption/templates";

describe("member draft export (TPR-20)",()=>{
  const fromTemplate=(i:number)=>{const t=publishedTemplates()[i];
    return {title:t.title,body:t.recordsDescription,agencyLabel:t.agencyLabel,templateId:t.templateId,templateVersion:t.version,
      rangeStart:t.rangeStart,rangeEnd:t.rangeEnd,feeCapUsd:25,electronicCopies:true};};
  it("addresses each distinct agency and matches its pinned template text with provenance",()=>{
    const [a,b]=[fromTemplate(0),fromTemplate(1)];
    expect(a.agencyLabel).not.toBe(b.agencyLabel);
    for(const d of [a,b]){
      const r=exportMemberDraft(d);
      if(!r.ready)throw new Error(r.problems.join());
      expect(r.text).toContain("To: "+d.agencyLabel);
      expect(r.text).toContain(d.body);
      expect(r.text).toContain(`${d.rangeStart} through ${d.rangeEnd}`);
      expect(r.text).toContain(`template ${d.templateId}, version ${d.templateVersion}`);
      expect(r.text).toContain("did not file or transmit it");
      // No hidden submission targets or markup.
      expect(r.text).not.toMatch(/https?:\/\/|mailto:|<[a-z]|action=/i);
      expect(r.filename).toMatch(/^[a-z0-9-]+\.txt$/);
    }
  });
  it("lists what is missing instead of exporting an incomplete request",()=>{
    const r=exportMemberDraft({...fromTemplate(0),agencyLabel:null,rangeEnd:null});
    expect(r.ready).toBe(false);
    if(!r.ready)expect(r.problems.length).toBeGreaterThanOrEqual(2);
    const blank=exportMemberDraft({title:"",body:"",agencyLabel:null,templateId:null,templateVersion:null,rangeStart:null,rangeEnd:null,feeCapUsd:25,electronicCopies:true});
    expect(blank.ready).toBe(false);
  });
});

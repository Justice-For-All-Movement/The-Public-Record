import {randomBytes} from "node:crypto";
import {describe,expect,it} from "vitest";
import {seal,unseal} from "../lib/auth/sealed";
const secret=randomBytes(32).toString("base64url");
describe("sealed short-lived state",()=>{
  it("round-trips, binds purpose and expires",()=>{
    const t=seal(secret,"login",{state:"abc"},60,1000);
    expect(unseal(secret,"login",t,1010)).toMatchObject({state:"abc",exp:1060});
    expect(unseal(secret,"fake-code",t,1010)).toBeNull();
    expect(unseal(secret,"login",t,1061)).toBeNull();
    expect(unseal(randomBytes(32).toString("base64url"),"login",t,1010)).toBeNull();
  });
  it("rejects tampering and hides contents",()=>{
    const t=seal(secret,"login",{state:"visible-marker"},60);
    expect(Buffer.from(t,"base64url").toString("latin1")).not.toContain("visible-marker");
    const flipped=t.slice(0,-2)+(t.endsWith("A")?"BB":"AA");
    expect(unseal(secret,"login",flipped)).toBeNull();
    expect(unseal(secret,"login","not a token")).toBeNull();
    expect(()=>seal(secret,"login",{},901)).toThrow();
  });
});

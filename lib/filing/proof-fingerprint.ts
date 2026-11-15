/**
 * TPR-22 — private proof fingerprints. A participant's receipt (screenshot,
 * confirmation email, PDF) is hashed in their own browser; only the SHA-256
 * reference is stored. Re-selecting the same file later proves it has not
 * changed. The fingerprint alone never makes an event "agency-confirmed".
 */
export const PROOF_PREFIX="sha256:";
export function proofReference(hexDigest:string):string {
  if(!/^[a-f0-9]{64}$/.test(hexDigest))throw new Error("Invalid SHA-256 digest");
  return PROOF_PREFIX+hexDigest;
}
export function isProofReference(ref:unknown):ref is string {
  return typeof ref==="string" && /^sha256:[a-f0-9]{64}$/.test(ref);
}
export type ProofCheck = "matches"|"does_not_match"|"no_fingerprint";
/** Constant-shape comparison of a recomputed digest to the stored reference. */
export function checkProof(storedRef:string|null,recomputedHex:string):ProofCheck {
  if(!isProofReference(storedRef))return "no_fingerprint";
  const a=storedRef.slice(PROOF_PREFIX.length);
  if(!/^[a-f0-9]{64}$/.test(recomputedHex))return "does_not_match";
  let diff=0;
  for(let i=0;i<64;i++)diff|=a.charCodeAt(i)^recomputedHex.charCodeAt(i);
  return diff===0?"matches":"does_not_match";
}
/** Browser/Node WebCrypto SHA-256 of file bytes. */
export async function sha256Hex(bytes:ArrayBuffer):Promise<string> {
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}

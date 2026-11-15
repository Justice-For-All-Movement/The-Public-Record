/**
 * Privacy-safe structured logging. Only allow-listed keys are emitted, values
 * are truncated, and anything resembling a token, email or connection string
 * is redacted. Never pass request bodies or identity claims here.
 */
const allowed=new Set(["event","route","status","reason","stage","mode","count","duration_ms","code"]);
const secretish=/(eyJ[A-Za-z0-9_-]{8,}|postgres(ql)?:\/\/\S+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|Bearer\s+\S+)/g;
export function safeLogLine(fields:Record<string,unknown>):string {
  const out:Record<string,string|number|boolean>={};
  for(const [k,v] of Object.entries(fields)){
    if(!allowed.has(k))continue;
    if(typeof v==="number"||typeof v==="boolean")out[k]=v;
    else if(typeof v==="string")out[k]=v.replace(secretish,"[redacted]").slice(0,200);
  }
  return JSON.stringify({ts:new Date().toISOString(),...out});
}
export function logEvent(fields:Record<string,unknown>):void {
  if(process.env.NODE_ENV==="test")return;
  console.log(safeLogLine(fields));
}

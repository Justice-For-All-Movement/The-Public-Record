/**
 * Mail provider boundary for TPR-25. No message is sent by this repository
 * unless an operator configures a provider; the fake provider records
 * messages in memory for tests and previews. Errors map to short codes so
 * logs and job rows never contain addresses or message bodies.
 */
export interface MailMessage {to:string;subject:string;text:string}
export type MailErrorCode = "invalid_credentials"|"provider_unavailable"|"rejected_message"|"not_configured";
export class MailError extends Error {
  constructor(readonly code:MailErrorCode,readonly retryable:boolean){super("Mail delivery failed: "+code);this.name="MailError";}
}
export interface MailProvider {readonly kind:"fake"|"resend"|"none";send(m:MailMessage):Promise<{providerId:string}>}

const addr=/^[^\s@<>()]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
function check(m:MailMessage){
  if(!addr.test(m.to) || !m.subject || m.subject.length>200 || /[\r\n]/.test(m.subject) || !m.text || m.text.length>10000)
    throw new MailError("rejected_message",false);
}
export function createFakeMailProvider(behaviour:"ok"|"invalid_credentials"|"offline"="ok"){
  const outbox:MailMessage[]=[];
  return {kind:"fake" as const,outbox,async send(m:MailMessage){
    check(m);
    if(behaviour==="invalid_credentials")throw new MailError("invalid_credentials",false);
    if(behaviour==="offline")throw new MailError("provider_unavailable",true);
    outbox.push(m);return {providerId:"fake-"+outbox.length};
  }};
}
/** Resend-compatible HTTPS API adapter (https://resend.com/docs/api-reference/emails/send-email). */
export function createResendProvider(cfg:{apiKey:string;from:string},fetcher:typeof fetch=fetch):MailProvider {
  if(!cfg.apiKey || !addr.test(cfg.from.replace(/^.*<|>$/g,"")))throw new MailError("not_configured",false);
  return {kind:"resend",async send(m){
    check(m);
    let res:Response;
    try{
      res=await fetcher("https://api.resend.com/emails",{method:"POST",redirect:"error",cache:"no-store",
        headers:{Authorization:"Bearer "+cfg.apiKey,"Content-Type":"application/json"},
        body:JSON.stringify({from:cfg.from,to:[m.to],subject:m.subject,text:m.text}),signal:AbortSignal.timeout(8000)});
    }catch{throw new MailError("provider_unavailable",true);}
    if(res.status===401||res.status===403)throw new MailError("invalid_credentials",false);
    if(res.status===422||res.status===400)throw new MailError("rejected_message",false);
    if(!res.ok)throw new MailError("provider_unavailable",res.status>=500||res.status===429);
    const body=await res.json().catch(()=>({})) as {id?:unknown};
    return {providerId:typeof body.id==="string"?body.id.slice(0,100):"unknown"};
  }};
}

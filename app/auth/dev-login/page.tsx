import type {Metadata} from "next";
import {notFound} from "next/navigation";
import {FAKE_PERSONAS} from "../../../lib/auth/providers";
import {fakeProvider} from "../../../lib/server/identity";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Synthetic sign-in | The Public Record",robots:{index:false}};
type Search=Promise<Record<string,string|string[]|undefined>>;
export default async function DevLogin({searchParams}:{searchParams:Search}){
  if(!fakeProvider())notFound();
  const q=await searchParams;
  const v=(k:string)=>typeof q[k]==="string"?q[k] as string:"";
  return <main style={{maxWidth:640,margin:"auto",padding:"48px 20px"}}>
    <p role="alert" style={{background:"#fff3cd",padding:14,borderRadius:8}}>
      Test identity provider. These are synthetic accounts for development and preview only. Do not enter real personal information anywhere in this deployment.
    </p>
    <h1>Choose a synthetic identity</h1>
    <form method="post" action="/api/auth/dev-authorize" style={{display:"grid",gap:12}}>
      <input type="hidden" name="state" value={v("state")}/>
      <input type="hidden" name="nonce" value={v("nonce")}/>
      <input type="hidden" name="code_challenge" value={v("code_challenge")}/>
      {FAKE_PERSONAS.map(p=><button key={p.id} name="persona" value={p.id} type="submit" style={{padding:12,font:"inherit"}}>{p.label}</button>)}
    </form>
  </main>;
}

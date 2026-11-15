import {config} from "./config";
import {createEncryptedStore,createLocalDriver,createMemoryDriver,createS3Driver,type PrivateObjectStore,type RawObjectDriver} from "../storage/object-store";
import {createClamavScanner,createFakeScanner,type MalwareScanner} from "../storage/scanner";

export interface UploadServices {store:PrivateObjectStore;scanner:MalwareScanner;storageKey:string}
const holder=globalThis as typeof globalThis & {__tprMemDriver?:RawObjectDriver};

/** Private storage + scanner, or a reason uploads are unavailable (fail closed). */
export function uploadServices():{ok:true;services:UploadServices}|{ok:false;reason:string} {
  const s=config().storage;
  if(s.problem)return {ok:false,reason:s.problem};
  if(s.driver==="none")return {ok:false,reason:"Private storage is not configured in this deployment."};
  if(s.scanner==="none")return {ok:false,reason:"No malware scanner is configured, so uploads are disabled."};
  let driver:RawObjectDriver;
  if(s.driver==="memory")driver=holder.__tprMemDriver??=createMemoryDriver();
  else if(s.driver==="local")driver=createLocalDriver(s.dir!);
  else driver=createS3Driver(s.s3!);
  const scanner=s.scanner==="fake"?createFakeScanner():createClamavScanner(s.clamav!.host,s.clamav!.port);
  return {ok:true,services:{store:createEncryptedStore(driver,s.key!),scanner,storageKey:s.key!}};
}

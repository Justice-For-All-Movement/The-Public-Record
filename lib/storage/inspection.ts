/**
 * TPR-28 — quarantine inspection. Runs on the server before anything is
 * stored: sniff the real type from bytes (never trust the browser), enforce
 * size, refuse active content (PDF JavaScript/launch/embedded files, Office
 * macros), and bound ZIP-based Office files against decompression bombs.
 * This is defence in depth beside a malware scanner, not a replacement.
 */
import {createHash} from "node:crypto";
import {inflateRawSync} from "node:zlib";

export const ALLOWED_TYPES=["application/pdf","text/plain","image/png","image/jpeg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] as const;
export type AllowedType=typeof ALLOWED_TYPES[number];
export const MAX_UPLOAD_BYTES=25*1024*1024;
export const MAX_ZIP_UNCOMPRESSED=100*1024*1024;
export const MAX_ZIP_RATIO=100;
export const MAX_ZIP_ENTRIES=2000;

export type RejectReason="empty"|"oversize"|"unsupported_type"|"misdeclared_type"|"active_content"|"archive_bomb"|"malformed";
export type Inspection =
  | {ok:true;mime:AllowedType;sha256:string;size:number;extension:string}
  | {ok:false;reason:RejectReason;sha256:string;size:number};

const startsWith=(b:Buffer,sig:number[])=>sig.every((v,i)=>b[i]===v);
const EXT:Record<AllowedType,string>={"application/pdf":"pdf","text/plain":"txt","image/png":"png","image/jpeg":"jpg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":"docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"xlsx"};

interface ZipEntry {name:string;compressed:number;uncompressed:number;method:number;localOffset:number}
/** Reads the ZIP central directory without trusting local headers. */
export function readZipDirectory(b:Buffer):ZipEntry[]|null {
  const min=Math.max(0,b.length-65557);
  let eocd=-1;
  for(let i=b.length-22;i>=min;i--)if(b.readUInt32LE(i)===0x06054b50){eocd=i;break;}
  if(eocd<0)return null;
  const count=b.readUInt16LE(eocd+10), size=b.readUInt32LE(eocd+12), offset=b.readUInt32LE(eocd+16);
  if(count===0xffff || offset===0xffffffff || offset+size>b.length)return null; // ZIP64 unsupported -> malformed
  const out:ZipEntry[]=[];
  let p=offset;
  for(let i=0;i<count;i++){
    if(p+46>b.length || b.readUInt32LE(p)!==0x02014b50)return null;
    const method=b.readUInt16LE(p+10), compressed=b.readUInt32LE(p+20), uncompressed=b.readUInt32LE(p+24);
    const nameLen=b.readUInt16LE(p+28), extraLen=b.readUInt16LE(p+30), commentLen=b.readUInt16LE(p+32), localOffset=b.readUInt32LE(p+42);
    if(p+46+nameLen>b.length)return null;
    out.push({name:b.subarray(p+46,p+46+nameLen).toString("utf8"),compressed,uncompressed,method,localOffset});
    p+=46+nameLen+extraLen+commentLen;
  }
  return out;
}
function entryBytes(b:Buffer,e:ZipEntry,limit:number):Buffer|null {
  if(e.localOffset+30>b.length || b.readUInt32LE(e.localOffset)!==0x04034b50)return null;
  const start=e.localOffset+30+b.readUInt16LE(e.localOffset+26)+b.readUInt16LE(e.localOffset+28);
  const data=b.subarray(start,start+e.compressed);
  if(e.method===0)return data.subarray(0,limit);
  if(e.method!==8)return null;
  try{return inflateRawSync(data,{maxOutputLength:limit});}catch{return null;}
}
function inspectOffice(b:Buffer,declared:AllowedType):RejectReason|AllowedType {
  const entries=readZipDirectory(b);
  if(!entries)return "malformed";
  if(entries.length>MAX_ZIP_ENTRIES)return "archive_bomb";
  let total=0;
  for(const e of entries){
    total+=e.uncompressed;
    if(e.name.includes("..") || e.name.startsWith("/"))return "malformed";
    if(e.compressed>0 && e.uncompressed/e.compressed>MAX_ZIP_RATIO)return "archive_bomb";
    if(/(^|\/)vbaProject\.bin$|\.(bin|exe|dll|js|vbs|ps1|zip|jar)$|activeX/i.test(e.name))return "active_content";
  }
  if(total>MAX_ZIP_UNCOMPRESSED)return "archive_bomb";
  const names=new Set(entries.map(e=>e.name));
  if(!names.has("[Content_Types].xml"))return "unsupported_type";
  const ct=entries.find(e=>e.name==="[Content_Types].xml")!;
  const types=entryBytes(b,ct,1024*1024);
  if(!types)return "malformed";
  if(/macroEnabled|vbaProject/i.test(types.toString("utf8")))return "active_content";
  const actual=names.has("word/document.xml")?"application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    names.has("xl/workbook.xml")?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":null;
  if(!actual)return "unsupported_type";
  return actual===declared?actual:"misdeclared_type";
}
function sniff(b:Buffer):AllowedType|"zip"|null {
  if(startsWith(b,[0x25,0x50,0x44,0x46,0x2d]))return "application/pdf";
  if(startsWith(b,[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))return "image/png";
  if(startsWith(b,[0xff,0xd8,0xff]))return "image/jpeg";
  if(startsWith(b,[0x50,0x4b,0x03,0x04]))return "zip";
  // Plain text: valid UTF-8, no NUL or other C0 controls except tab/newlines.
  const text=new TextDecoder("utf-8",{fatal:false}).decode(b);
  if(!text.includes("�") && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))return "text/plain";
  return null;
}
const PDF_ACTIVE=/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA|SubmitForm|ImportData)\b/;

export function inspectUpload(bytes:Uint8Array,declaredType:string):Inspection {
  const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const sha256=createHash("sha256").update(b).digest("hex");
  const fail=(reason:RejectReason):Inspection=>({ok:false,reason,sha256,size:b.length});
  if(b.length===0)return fail("empty");
  if(b.length>MAX_UPLOAD_BYTES)return fail("oversize");
  if(!(ALLOWED_TYPES as readonly string[]).includes(declaredType))return fail("unsupported_type");
  const declared=declaredType as AllowedType;
  const s=sniff(b);
  if(!s)return fail("unsupported_type");
  let mime:AllowedType;
  if(s==="zip"){
    if(!declared.includes("openxmlformats"))return fail("misdeclared_type");
    const r=inspectOffice(b,declared);
    if(!(ALLOWED_TYPES as readonly string[]).includes(r))return fail(r as RejectReason);
    mime=r as AllowedType;
  }else{
    if(s!==declared)return fail("misdeclared_type");
    mime=s;
  }
  if(mime==="application/pdf"){
    // Also catch hex-escaped names like /J#61vaScript.
    const latin=b.toString("latin1").replace(/#([0-9a-fA-F]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16)));
    if(PDF_ACTIVE.test(latin))return fail("active_content");
    if(!/%%EOF\s*$/.test(latin.slice(-1024)))return fail("malformed");
  }
  return {ok:true,mime,sha256,size:b.length,extension:EXT[mime]};
}

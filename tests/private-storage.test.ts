import {mkdtempSync,readdirSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import net from "node:net";
import {randomBytes,randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {createEncryptedStore,createLocalDriver,createMemoryDriver,createS3Driver,signV4,StorageError} from "../lib/storage/object-store";
import {inspectUpload,MAX_UPLOAD_BYTES} from "../lib/storage/inspection";
import {createClamavScanner,createFakeScanner} from "../lib/storage/scanner";
import {loadConfig} from "../lib/server/config";
import {DOCX,docx,EICAR,makeZip,pdf} from "./helpers/zip";

const masterKey=randomBytes(32).toString("base64url");
const key=()=>`private/quarantine/v1/${"a".repeat(32)}/${randomUUID()}`;

describe("encrypted private object storage (TPR-09)",()=>{
  it("stores only authenticated ciphertext bound to its object key",async()=>{
    const raw=createMemoryDriver(),store=createEncryptedStore(raw,masterKey);
    const k=key(),secret=Buffer.from("Synthetic agency letter");
    await store.put(k,secret);
    const stored=Buffer.from(raw.objects.get(k)!);
    expect(stored.includes(secret)).toBe(false);
    expect(Buffer.from((await store.get(k))!).toString()).toBe("Synthetic agency letter");
    const other=key();raw.objects.set(other,stored); // ciphertext moved to another key
    await expect(store.get(other)).rejects.toThrow(StorageError);
    stored[stored.length-20]^=1;raw.objects.set(k,stored);
    await expect(store.get(k)).rejects.toThrow(StorageError);
    await expect(createEncryptedStore(raw,randomBytes(32).toString("base64url")).get(other)).rejects.toThrow();
    await expect(store.put("public/anything.pdf",secret)).rejects.toThrow(/Invalid private object key/);
    expect(()=>createEncryptedStore(raw,"short")).toThrow();
  });
  it("keeps local files inside the root with private permissions",async()=>{
    const root=mkdtempSync(path.join(tmpdir(),"tpr-store-"));
    try{
      const store=createEncryptedStore(createLocalDriver(root),masterKey);
      const k=key();await store.put(k,Buffer.from("x"));
      const file=path.join(root,k);
      expect(readFileSync(file).subarray(0,4).toString()).toBe("TPR1");
      const {statSync}=await import("node:fs");expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(await store.get(key())).toBeNull();
      await store.delete(k);expect(readdirSync(path.dirname(file))).toEqual([]);
      await expect(createLocalDriver(root).put("private/quarantine/v1/../../etc/passwd",Buffer.from("x"))).rejects.toThrow();
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  it("signs S3 requests per the published SigV4 example and uses path-style private keys",async()=>{
    // AWS S3 SigV4 documentation example (GET Object with Range header).
    const auth=signV4({method:"GET",host:"examplebucket.s3.amazonaws.com",path:"/test.txt",
      headers:{range:"bytes=0-9","x-amz-content-sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","x-amz-date":"20130524T000000Z"},
      payloadHash:"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",region:"us-east-1",
      accessKeyId:"AKIAIOSFODNN7EXAMPLE",secretAccessKey:"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",amzDate:"20130524T000000Z"});
    expect(auth).toBe("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    const calls:{url:string;init:RequestInit}[]=[];
    const fetcher=vi.fn(async(url:string,init:RequestInit)=>{calls.push({url,init});return new Response(init.method==="GET"?null:"",{status:init.method==="GET"?404:200});});
    const drv=createS3Driver({endpoint:"https://s3.us-west-004.backblazeb2.com",region:"us-west-004",bucket:"tpr-private-test",
      accessKeyId:"test-key-id",secretAccessKey:"test-secret"},fetcher as unknown as typeof fetch);
    const k=key();await drv.put(k,Buffer.from("cipher"));
    expect(await drv.get(k)).toBeNull();
    expect(calls[0].url).toBe(`https://s3.us-west-004.backblazeb2.com/tpr-private-test/${k}`);
    expect(String((calls[0].init.headers as Record<string,string>).Authorization)).toMatch(/^AWS4-HMAC-SHA256 Credential=test-key-id\//);
    expect(JSON.stringify(calls)).not.toContain("test-secret");
    expect(()=>createS3Driver({endpoint:"http://insecure.example",region:"x1",bucket:"b-ok",accessKeyId:"a",secretAccessKey:"b"})).toThrow();
  });
  it("never enables fake scanners or memory storage in production",()=>{
    const c=loadConfig({NODE_ENV:"production",STORAGE_DRIVER:"memory",MALWARE_SCANNER:"fake",PRIVATE_STORAGE_KEY:masterKey});
    expect(c.storage).toMatchObject({driver:"none",scanner:"none"});
    expect(loadConfig({NODE_ENV:"test",STORAGE_DRIVER:"s3",PRIVATE_STORAGE_KEY:masterKey}).storage.problem).toMatch(/S3_ENDPOINT/);
  });
});

describe("quarantine inspection (TPR-28)",()=>{
  it("accepts well-formed allowed types by their bytes",()=>{
    expect(inspectUpload(pdf(),"application/pdf")).toMatchObject({ok:true,mime:"application/pdf",extension:"pdf"});
    expect(inspectUpload(Buffer.from("Plain synthetic note\n"),"text/plain")).toMatchObject({ok:true});
    expect(inspectUpload(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3]),"image/png")).toMatchObject({ok:true});
    expect(inspectUpload(docx(),DOCX)).toMatchObject({ok:true,extension:"docx"});
  });
  it("refuses misdeclared, oversize, empty, unsupported and malformed files",()=>{
    const r=(b:Buffer,t:string)=>{const x=inspectUpload(b,t);return x.ok?"ok":x.reason;};
    expect(r(pdf(),"image/png")).toBe("misdeclared_type");
    expect(r(Buffer.from("MZ\x90\x00\x03binary\x00\x00","latin1"),"application/pdf")).toBe("unsupported_type");
    expect(r(Buffer.alloc(0),"text/plain")).toBe("empty");
    expect(r(Buffer.alloc(MAX_UPLOAD_BYTES+1,0x41),"text/plain")).toBe("oversize");
    expect(r(pdf(),"application/x-msdownload")).toBe("unsupported_type");
    expect(r(Buffer.from("%PDF-1.4 truncated","latin1"),"application/pdf")).toBe("malformed");
    expect(r(docx(),"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("misdeclared_type");
  });
  it("refuses active content and decompression bombs",()=>{
    const r=(b:Buffer,t:string)=>{const x=inspectUpload(b,t);return x.ok?"ok":x.reason;};
    expect(r(pdf("/OpenAction << /S /JavaScript /JS (app.alert(1)) >>"),"application/pdf")).toBe("active_content");
    expect(r(pdf("/OpenAction << /S /J#61vaScript >>"),"application/pdf")).toBe("active_content");
    expect(r(pdf("/EmbeddedFile << >>"),"application/pdf")).toBe("active_content");
    expect(r(docx({"word/vbaProject.bin":"macro"}),DOCX)).toBe("active_content");
    expect(r(docx({"word/media/huge.xml":Buffer.alloc(2*1024*1024,0)}),DOCX)).toBe("archive_bomb");
    expect(r(makeZip({"payload.txt":"x"}),DOCX)).toBe("unsupported_type");
  });
});

describe("malware scanners",()=>{
  it("fake scanner flags the EICAR test signature",async()=>{
    expect(await createFakeScanner().scan(Buffer.from("clean"))).toEqual({verdict:"clean"});
    expect((await createFakeScanner().scan(Buffer.from(EICAR,"latin1"))).verdict).toBe("infected");
  });
  it("speaks clamd INSTREAM and fails closed when unavailable",async()=>{
    const server=net.createServer(sock=>{
      let buf=Buffer.alloc(0);
      sock.on("data",d=>{buf=Buffer.concat([buf,d]);
        if(buf.subarray(buf.length-4).equals(Buffer.alloc(4))){
          const infected=buf.includes(Buffer.from("EICAR"));
          sock.end(infected?"stream: Eicar-Test-Signature FOUND\0":"stream: OK\0");
        }});
    });
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",()=>r()));
    const port=(server.address() as net.AddressInfo).port;
    try{
      const s=createClamavScanner("127.0.0.1",port);
      expect(await s.scan(Buffer.from("clean bytes"))).toEqual({verdict:"clean"});
      expect(await s.scan(Buffer.from(EICAR,"latin1"))).toEqual({verdict:"infected",signature:"Eicar-Test-Signature"});
    }finally{server.close();}
    expect((await createClamavScanner("127.0.0.1",1,2000).scan(Buffer.from("x"))).verdict).toBe("error");
  });
});

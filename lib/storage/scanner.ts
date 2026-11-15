/**
 * Malware scanning boundary (TPR-28). Uploads fail closed: without a working
 * scanner nothing is stored. Drivers: a fake scanner (EICAR test signature,
 * tests/previews only) and a ClamAV clamd INSTREAM client (CLAMAV_HOST/PORT).
 */
import net from "node:net";

export type ScanVerdict = {verdict:"clean"}|{verdict:"infected";signature:string}|{verdict:"error";code:string};
export interface MalwareScanner {readonly kind:"fake"|"clamav";scan(bytes:Uint8Array):Promise<ScanVerdict>}

const EICAR="X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
export function createFakeScanner():MalwareScanner {
  return {kind:"fake",async scan(bytes){
    return Buffer.from(bytes).includes(Buffer.from(EICAR,"latin1"))?{verdict:"infected",signature:"Eicar-Test-Signature"}:{verdict:"clean"};
  }};
}

/** clamd INSTREAM protocol: zINSTREAM\0, <len><chunk>..., <0>; reply "stream: OK" / "stream: X FOUND". */
export function createClamavScanner(host:string,port:number,timeoutMs=20000):MalwareScanner {
  if(!host || !Number.isInteger(port) || port<1 || port>65535)throw new Error("Invalid ClamAV address");
  return {kind:"clamav",scan(bytes){
    return new Promise<ScanVerdict>(resolve=>{
      let reply="";let done=false;
      const finish=(v:ScanVerdict)=>{if(!done){done=true;socket.destroy();resolve(v);}};
      const socket=net.connect({host,port},()=>{
        socket.write("zINSTREAM\0");
        const buf=Buffer.from(bytes);
        for(let i=0;i<buf.length;i+=64*1024){
          const chunk=buf.subarray(i,i+64*1024);
          const len=Buffer.alloc(4);len.writeUInt32BE(chunk.length);
          socket.write(len);socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
      socket.setTimeout(timeoutMs,()=>finish({verdict:"error",code:"scanner_timeout"}));
      socket.on("data",d=>{reply+=d.toString("utf8");if(reply.includes("\0")||reply.includes("\n"))socket.end();});
      socket.on("error",()=>finish({verdict:"error",code:"scanner_unavailable"}));
      socket.on("close",()=>{
        const r=reply.replace(/\0/g,"").trim();
        if(/^stream: OK$/.test(r))finish({verdict:"clean"});
        else{const m=/^stream: (.{1,200}) FOUND$/.exec(r);
          finish(m?{verdict:"infected",signature:m[1].replace(/[^A-Za-z0-9._-]/g,"_")}:{verdict:"error",code:"scanner_error"});}
      });
    });
  }};
}

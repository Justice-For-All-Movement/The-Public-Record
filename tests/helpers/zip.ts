import {deflateRawSync,crc32} from "node:zlib";
/** Minimal ZIP writer for synthetic Office fixtures (deflate, no ZIP64). */
export function makeZip(entries:Record<string,string|Buffer>):Buffer {
  const locals:Buffer[]=[],centrals:Buffer[]=[];let offset=0;
  for(const [name,content] of Object.entries(entries)){
    const data=Buffer.isBuffer(content)?content:Buffer.from(content);
    const comp=deflateRawSync(data),n=Buffer.from(name),crc=crc32(data);
    const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50,0);l.writeUInt16LE(20,4);l.writeUInt16LE(8,8);
    l.writeUInt32LE(crc,14);l.writeUInt32LE(comp.length,18);l.writeUInt32LE(data.length,22);l.writeUInt16LE(n.length,26);
    locals.push(l,n,comp);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);
    c.writeUInt32LE(crc,16);c.writeUInt32LE(comp.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
    centrals.push(c,n);offset+=30+n.length+comp.length;
  }
  const cd=Buffer.concat(centrals),e=Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50,0);e.writeUInt16LE(Object.keys(entries).length,8);e.writeUInt16LE(Object.keys(entries).length,10);
  e.writeUInt32LE(cd.length,12);e.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,cd,e]);
}
export const DOCX="application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const docx=(extra:Record<string,string|Buffer>={})=>makeZip({"[Content_Types].xml":'<?xml version="1.0"?><Types/>',
  "word/document.xml":"<w:document>Synthetic letter</w:document>",...extra});
export const pdf=(body="BT (Synthetic agency letter) Tj ET")=>Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n${body}\n%%EOF\n`,"latin1");
export const EICAR="X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

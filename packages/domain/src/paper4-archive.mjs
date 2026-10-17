// Bounded, in-memory ZIP handling shared by single-paper and collection
// packages. No entry is ever extracted or interpreted as executable code.
import { inflateRawSync, deflateRawSync } from 'node:zlib';
import { fail } from './security.mjs';
const decoder = new TextDecoder('utf-8', { fatal: true });
function invalid(message) { fail(400,'PAPER4_IMPORT',message); }
export function archiveText(buffer,label='Package') {
 let value;try{value=decoder.decode(buffer);}catch{invalid(`${label} must be UTF-8 text.`);}
 if(value.includes('\0'))invalid(`${label} contains a NUL byte.`);return value;
}
function safeArchiveName(name,directory=false){
 if(!name||name.length>240||name.includes('\\')||/[\x00-\x1f\x7f]/.test(name)||name.startsWith('/')||/^[A-Za-z]:/.test(name)
  ||name.split('/').some((part,index,all)=>part==='.'||part==='..'||!part&&!(directory&&index===all.length-1)))
  invalid(`Unsafe ZIP entry: ${name}.`);
}
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function paper4Crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function readPaper4Archive(buffer, { maxEntries=100, maxEntryBytes=256*1024, maxExpandedBytes=2*1024*1024, nameAllowed }={}) {
  // ZIP's end-of-central-directory is in its final 65,557 bytes. Reject
  // multi-disk, ZIP64, encrypted and unsupported methods instead of making
  // assumptions about offsets or silently skipping unknown entries.
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) {
      eocd = offset; break;
    }
  }
  if (eocd < 0 || buffer.readUInt16LE(eocd + 4) !== 0 || buffer.readUInt16LE(eocd + 6) !== 0)
    invalid('Invalid or multi-disk ZIP package.');
  const count = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralStart = buffer.readUInt32LE(eocd + 16);
  if (count < 1 || count > maxEntries || count === 65535 || centralStart + centralSize !== eocd ||
      buffer.readUInt16LE(eocd + 8) !== count) invalid('ZIP entry count or directory is invalid.');
  const entries = new Map();
  const seenLower = new Set();
  let offset = centralStart;
  let expandedTotal = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > eocd || buffer.readUInt32LE(offset) !== 0x02014b50) invalid('ZIP central directory is invalid.');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const disk = buffer.readUInt16LE(offset + 34);
    const external = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > eocd || nameLength < 1 || disk !== 0 || compressedSize === 0xffffffff ||
        uncompressedSize === 0xffffffff || localOffset === 0xffffffff || flags & 1 || ![0, 8].includes(method))
      invalid('Unsupported ZIP entry.');
    const name = archiveText(buffer.subarray(offset + 46, offset + 46 + nameLength), 'ZIP filename');
    const directory = name.endsWith('/');
    safeArchiveName(name, directory);
    if(nameAllowed)nameAllowed(name,directory);
    const lower = name.toLowerCase();
    if (seenLower.has(lower)) invalid(`Duplicate ZIP entry: ${name}.`);
    seenLower.add(lower);
    // A symlink's Unix mode is stored in the high word of external attrs.
    if ((external >>> 16 & 0xf000) === 0xa000) invalid(`Symlinks are not allowed in ZIP packages: ${name}.`);
    if (uncompressedSize > maxEntryBytes || (compressedSize === 0 ? uncompressedSize > 0 : uncompressedSize > compressedSize * 100))
      invalid(`ZIP entry exceeds its size or compression-ratio limit: ${name}.`);
    expandedTotal += uncompressedSize;
    if (expandedTotal > maxExpandedBytes) invalid('ZIP package exceeds its expanded size limit.');
    if (localOffset + 30 > centralStart || buffer.readUInt32LE(localOffset) !== 0x04034b50 ||
        buffer.readUInt16LE(localOffset + 8) !== method || buffer.readUInt16LE(localOffset + 6) !== flags)
      invalid('ZIP local entry does not match its directory.');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    const dataStart = localNameStart + localNameLength + localExtraLength;
    if (dataStart + compressedSize > centralStart ||
        !buffer.subarray(localNameStart, localNameStart + localNameLength).equals(Buffer.from(name)))
      invalid('ZIP local entry path or data is invalid.');
    let contents;
    try {
      const zipped = buffer.subarray(dataStart, dataStart + compressedSize);
      contents = method === 0 ? zipped : inflateRawSync(zipped, { maxOutputLength: Math.min(maxEntryBytes, uncompressedSize) + 1 });
    } catch { invalid(`ZIP entry cannot be decompressed: ${name}.`); }
    if (contents.length !== uncompressedSize || paper4Crc32(contents) !== expectedCrc)
      invalid(`ZIP entry checksum or length is invalid: ${name}.`);
    if (!directory) entries.set(name, contents);
    else if (contents.length) invalid('ZIP directory entry must be empty.');
    offset = end;
  }
  if (offset !== eocd) invalid('ZIP central directory size is invalid.');
  return entries;
}

// Stored or deflated entries use the same strict ZIP subset accepted above.
// Very compressible files are stored to keep our own ratio guard roundtrippable.
export function writePaper4Archive(entries){
 const local=[],central=[];let offset=0;
 if(!entries.length||entries.length>500)invalid('ZIP entry count is invalid.');
 const seen=new Set();
 for(const [name,value] of entries){
  safeArchiveName(name);if(seen.has(name.toLowerCase()))invalid(`Duplicate ZIP entry: ${name}.`);seen.add(name.toLowerCase());
  const filename=Buffer.from(name),contents=Buffer.isBuffer(value)?value:Buffer.from(value,'utf8');
  const zipped=deflateRawSync(contents);const compress=zipped.length<contents.length&&contents.length<=Math.max(zipped.length,1)*100;
  const data=compress?zipped:contents,method=compress?8:0,crc=paper4Crc32(contents);
  const head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50,0);head.writeUInt16LE(20,4);head.writeUInt16LE(0x800,6);
  head.writeUInt16LE(method,8);head.writeUInt16LE(33,12);head.writeUInt32LE(crc,14);head.writeUInt32LE(data.length,18);head.writeUInt32LE(contents.length,22);head.writeUInt16LE(filename.length,26);
  local.push(head,filename,data);
  const row=Buffer.alloc(46);row.writeUInt32LE(0x02014b50,0);row.writeUInt16LE(20,4);row.writeUInt16LE(20,6);row.writeUInt16LE(0x800,8);
  row.writeUInt16LE(method,10);row.writeUInt16LE(33,14);row.writeUInt32LE(crc,16);row.writeUInt32LE(data.length,20);row.writeUInt32LE(contents.length,24);row.writeUInt16LE(filename.length,28);row.writeUInt32LE(offset,42);
  central.push(row,filename);offset+=head.length+filename.length+data.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);
 end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}

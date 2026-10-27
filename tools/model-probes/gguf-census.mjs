// GGUF tensor census, v2. v1 read 5 bytes for an array's 8-byte element count, which desynchronised the
// cursor and produced 1.8e18-byte "strings". This version slurps only the header/KV/tensor-info prefix
// (never the 30+ GB of tensor data) and walks it with one cursor.
// Per-tensor bytes = difference between consecutive data offsets: exact up to alignment padding, and it
// needs no ggml type-size table recalled from memory.
import { open } from "node:fs/promises";

const path = process.argv[2];
const fh = await open(path, "r");
const PRE = 24 * 1024 * 1024;
const buf = Buffer.alloc(PRE);
const { bytesRead } = await fh.read(buf, 0, PRE, 0);
const { size: fileSize } = await fh.stat();
if (buf.toString("latin1", 0, 4) !== "GGUF") throw new Error("not a GGUF file");
const version = buf.readUInt32LE(4);
const nTensors = Number(buf.readBigUInt64LE(8));
const nKV = Number(buf.readBigUInt64LE(16));
let p = 24;
const SCALAR = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
const readStr = () => { const n = Number(buf.readBigUInt64LE(p)); p += 8; const s = buf.toString("utf8", p, p + n); p += n; return s; };
function readVal(t) {
  if (t === 7) { const v = buf[p] === 1; p += 1; return v; }
  if (t === 8) return readStr();
  if (t === 9) { const et = buf.readUInt32LE(p); p += 4; const n = Number(buf.readBigUInt64LE(p)); p += 8; return Array.from({ length: n }, () => readVal(et)); }
  const s = SCALAR[t]; if (s === undefined) throw new Error("unknown GGUF value type " + t);
  const v = t === 6 ? buf.readFloatLE(p) : t === 12 ? buf.readDoubleLE(p) : s === 8 ? Number(buf.readBigUInt64LE(p)) : s === 4 ? buf.readUInt32LE(p) : buf.readInt8(p);
  p += s; return v;
}
const meta = {};
// GGUF KV: key(string), value type (u32), value. v1/v2 assumed u8 and desynced every pair.
for (let i = 0; i < nKV; i++) { const k = readStr(); const t = buf.readUInt32LE(p); p += 4; meta[k] = readVal(t); }
const align = Number(meta["general.alignment"] ?? 32);
const infos = [];
for (let i = 0; i < nTensors; i++) {
  const name = readStr();
  const nd = buf.readUInt32LE(p); p += 4;
  const dims = []; for (let d = 0; d < nd; d++) { dims.push(Number(buf.readBigUInt64LE(p))); p += 8; }
  const type = buf.readUInt32LE(p); p += 4;
  const off = Number(buf.readBigUInt64LE(p)); p += 8;
  infos.push({ name, dims, type, off });
}
const sorted = infos.slice().sort((a, b) => a.off - b.off);
const dataStart = Math.ceil(p / align) * align;
for (let i = 0; i < sorted.length; i++) sorted[i].bytes = (i + 1 < sorted.length ? sorted[i + 1].off : fileSize - dataStart) - sorted[i].off;
const GB = (b) => (b / 1e9).toFixed(2);
console.log(`GGUF v${version}  tensors=${nTensors}  kv=${nKV}  file=${GB(fileSize)} GB  alignment=${align}`);
console.log(`\narchitecture metadata (from THIS file, not from memory):`);
for (const [k, v] of Object.entries(meta).filter(([k]) => !/^tokenizer|^general.name|^general.architecture$|^split/.test(k))) console.log(`  ${k} = ${JSON.stringify(v)}`.slice(0, 120));
const buckets = new Map();
for (const t of sorted) {
  const n = t.name;
  let cls = "other";
  if (/_exps\./.test(n)) cls = "ROUTED EXPERTS  (movable to RAM by --cpu-moe)";
  else if (/_shexp\./.test(n)) cls = "shared expert (runs for every token -> VRAM)";
  else if (/attn_/.test(n)) cls = "attention (every token -> VRAM)";
  else if (/\.ffn_/.test(n)) cls = "dense ffn (every token -> VRAM)";
  else if (/token_embd|output_norm|^output\.|per_layer|rope|^ssm|conv1d/.test(n)) cls = "embedding/norm/other";
  const c = buckets.get(cls) || { bytes: 0, n: 0 }; c.bytes += t.bytes; c.n++; buckets.set(cls, c);
}
console.log(`\nbyte attribution by class:`);
for (const [cls, c] of [...buckets].sort((a, b) => b[1].bytes - a[1].bytes)) console.log(`  ${GB(c.bytes).padStart(7)} GB  ${String(c.n).padStart(4)} tensors  ${cls}`);
const CARD = 15804 * 1024 * 1024;
const movable = buckets.get("ROUTED EXPERTS  (movable to RAM by --cpu-moe)")?.bytes ?? 0;
const weightBytes = fileSize - dataStart;
const stuck = weightBytes - movable;
console.log(`\nDECISION ARITHMETIC — measured on this box: A4000 free ${(CARD / 1e6).toFixed(0)} MB, RAM available 34 GiB, ulimit -l = 8 MiB (mlock unavailable):`);
console.log(`  total weight bytes ......... ${GB(weightBytes)} GB`);
console.log(`  immovable (attention+shared+embedding+dense) ${GB(stuck)} GB  -> this is the VRAM FLOOR before any KV`);
console.log(`  movable by --cpu-moe ....... ${GB(movable)} GB  -> must survive in the page cache (cannot mlock)`);
console.log(`  immovable fits the card?   ${stuck <= CARD ? "YES" : "NO"}   (floor ${GB(stuck)} GB vs ${(CARD / 1e9).toFixed(1)} GB free)`);
console.log(`  whole file fits in RAM? .... ${weightBytes <= 34 * 1024 ** 3 ? "YES" : "NO"}  (34 GiB available; the primary also lives in RAM)`);
await fh.close();

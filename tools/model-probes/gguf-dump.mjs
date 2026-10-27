import { open } from "node:fs/promises";
const fh = await open(process.argv[2], "r");
const buf = Buffer.alloc(4 * 1024 * 1024);
await fh.read(buf, 0, buf.length, 0);
let p = 24;
const readStr = () => { const n = Number(buf.readBigUInt64LE(p)); p += 8; const s = buf.toString("utf8", p, p + n); p += n; return { n, s }; };
const SC = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
const TN = ["u8","i8","u16","i16","u32","i32","f32","bool","str","arr","u64","i64","f64"];
for (let i = 0; i < 42; i++) {
  const k = readStr(); const t = buf[p]; p += 1;
  let desc;
  if (t === 8) desc = JSON.stringify(readStr().s);
  else if (t === 9) { const et = buf[p]; p += 1; const n = Number(buf.readBigUInt64LE(p)); p += 8; desc = `arr<${TN[et]}> len=${n}`; if (et === 8) desc += " (element offsets skipped for this dump; NOT advanced)"; else { const sz = SC[et]; p += n * sz; desc += ` advanced ${n * sz}B`; } }
  else { const sz = SC[t]; desc = t === 6 ? String(buf.readFloatLE(p)) : t === 12 ? String(buf.readDoubleLE(p)) : String(buf.readBigUInt64LE ? Number(buf.readBigUInt64LE(p)) : 0); p += sz; }
  console.log(`  [${String(i).padStart(2)}] off=${String(p).padStart(6)} ${TN[t].padEnd(5)} ${k.s} = ${String(desc).slice(0, 60)}`);
}
console.log(`\ncursor after KV = ${p}`);
for (let i = 0; i < 3; i++) {
  const nm = readStr(); const nd = buf.readUInt32LE(p); p += 4;
  const dims = []; for (let d = 0; d < nd; d++) { dims.push(Number(buf.readBigUInt64LE(p))); p += 8; }
  const type = buf.readUInt32LE(p); p += 4; const off = Number(buf.readBigUInt64LE(p)); p += 8;
  console.log(`  tensor ${nm.s} dims=[${dims}] type=${type} off=${off}`);
}
await fh.close();

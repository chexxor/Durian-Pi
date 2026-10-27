import { open } from "node:fs/promises";
const fh = await open(process.argv[2], "r"); const buf = Buffer.alloc(24*1024*1024); await fh.read(buf,0,buf.length,0);
const nT = Number(buf.readBigUInt64LE(8)), nKV = Number(buf.readBigUInt64LE(16));
let p = 24; const rs=()=>{const n=Number(buf.readBigUInt64LE(p));p+=8;const s=buf.toString("utf8",p,p+n);p+=n;return s;};
const SC={0:1,1:1,2:2,3:2,4:4,5:4,6:4,7:1,10:8,11:8,12:8};
function rv(t){ if(t===7){const v=buf[p]===1;p+=1;return v} if(t===8)return rs(); if(t===9){const et=buf.readUInt32LE(p);p+=4;const n=Number(buf.readBigUInt64LE(p));p+=8;return Array.from({length:n},()=>rv(et))} const s=SC[t];const v=s===4?buf.readUInt32LE(p):s===8?Number(buf.readBigUInt64LE(p)):s===2?buf.readUInt16LE(p):buf.readUInt8(p);p+=s;return v }
const m={}; for(let i=0;i<nKV;i++){const k=rs();const t=buf.readUInt32LE(p);p+=4;m[k]=rv(t)}
for (const k of Object.keys(m)) if (/chat_template|tokenizer\.ggml\.(pre|add_bos|bos|eos|eot|eom|sep|nlt|token_type|special|vocab_size|scores|merges|byte_fallback|model)|utf8_flush|spacetrim|add_prefix/.test(k)) {
  const v = Array.isArray(m[k]) ? `[array len ${m[k].length}]` : String(m[k]);
  console.log(`  ${k} = ${v.length > 150 ? v.slice(0, 150).replace(/\n/g, "\\n") + "…" : v}`);
}
const tpl = m["tokenizer.chat_template"];
if (tpl) { console.log(`\n  chat_template length=${tpl.length}`); console.log(`  mentions tools? ${/tools|tool_call|function/i.test(tpl)}`); for (const line of tpl.split("\n").filter(l=>/tool|function/i.test(l)).slice(0,6)) console.log(`    | ${line.trim().slice(0,140)}`); }
else console.log("\n  NO chat_template in the GGUF -> llama.cpp cannot do tool calling with this file");
await fh.close();

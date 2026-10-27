const get=async(u)=>{try{const r=await fetch(u,{headers:{"User-Agent":"x"}});return r.ok?await r.text():null}catch{return null}};
for(const b of ["mistralai/Devstral-Small-2-24B-Instruct-2512","mistralai/Devstral-Small-2-24B-Instruct-2507"]){
  const md=await get(`https://huggingface.co/${b}/raw/main/README.md`); if(!md){console.log(b,"README unreachable");continue}
  const L=md.split("\n");
  console.log("\n=== "+b+" : tables mentioning code/agentic benchmarks ===");
  for(let i=0;i<L.length;i++){
    if(!/^\s*\|/.test(L[i])||/^\s*\|[\s|:-]+\|\s*$/.test(L[i]))continue;
    if(!/(SWE|LiveCodeBench|Terminal|BFCL|SWE-bench|Aider|CL-bench|Agentic|MMLU|HumanEval)/i.test(L[i]))continue;
    const blk=[L[i]];for(let j=i+1;j<L.length&&L[j].trim().startsWith("|");j++)blk.push(L[j]);
    console.log(` [${i+1}] `+blk[0].replace(/\|/g," ").replace(/\s+/g," ").trim().slice(0,180));
    for(const l of blk.slice(1))if(!/^[\s|:-]+$/.test(l))console.log("    "+l.replace(/\|/g," ").replace(/\s+/g," ").replace(/<\/?[bu]>|\*\*/g,"").trim().slice(0,180));
    i+=blk.length;
  }
}

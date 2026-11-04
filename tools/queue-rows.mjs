#!/usr/bin/env node
// tools/queue-rows.mjs — project named queue rows out of a `queue --json` dump WITHOUT dumping the queue
// into your context. Pipe, never paste:
//
//   DURIG_DB=./selfdev.sqlite node cli.mjs queue --json > /tmp/q.json 2>&1
//   node tools/queue-rows.mjs 5066 5071 < /tmp/q.json       # the rows you asked for, nothing else
//   node tools/queue-rows.mjs --census < /tmp/q.json        # status counts + who holds the non-terminal rows
//
// Since #5063 landed, the CLI itself can scope a read (`node cli.mjs queue --id 5066`, 4.5 KB vs 22 MB), so a
// single row no longer needs this. It still wins for MANY rows in one store open, and for the census, which
// the CLI has no verb for. Item-object keys are `id from to subject body status optimizedVia transitions
// resultSummary` — `status`, not `state` (a projection that reads `.state` silently prints `undefined`).
const ids = process.argv.slice(2).filter((a) => a !== "--census").map(Number);
const census = process.argv.includes("--census");
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  // `--json` is not pure JSON on stdout since #5047: a `{"spend":...}` line prints at every CLI start.
  const j = JSON.parse(s.slice(s.indexOf("{\n") >= 0 ? s.indexOf("{\n") : s.indexOf("{")));
  const items = j.items || [];
  const by = new Map(items.map((i) => [i.id, i]));
  if (census) {
    const st = {};
    for (const i of items) st[i.status] = (st[i.status] || 0) + 1;
    console.log(`rows ${items.length}  ${JSON.stringify(st)}`);
    const held = {};
    for (const i of items)
      if (i.status === "queued" || i.status === "claimed" || i.status === "held")
        held[`${i.to}:${i.status}`] = (held[`${i.to}:${i.status}`] || 0) + 1;
    console.log(Object.entries(held)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(" "));
  }
  for (const id of ids) {
    const i = by.get(id);
    if (!i) { console.log(`#${id}: ABSENT`); continue; }
    const t = (i.transitions || []).map((x) => `${x.event ?? x.status ?? "?"}@${(x.at || "").slice(0, 16)}${x.by ? " by " + x.by : ""}`).slice(-3).join("  ");
    console.log(`#${i.id} [${i.status}] ${i.from} -> ${i.to}`);
    console.log(`  subject: ${i.subject}`);
    if (t) console.log(`  recent: ${t}`);
    console.log(`  body:`);
    console.log(String(i.body ?? "").split("\n").map((l) => "    " + l).join("\n"));
    console.log("");
  }
});

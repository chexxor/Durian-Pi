// LANDED SHIM (tracked, tools/model-probes/) — labelled a shim on purpose: this is NOT the product fix.
// The product fix is ROADMAP 254 (stream, or set an explicit dispatcher timeout, and print `err.cause`), and when it
// lands this file goes away. Landed 2026-10-29 under the operator's GRANT 4 (D165: instrument hygiene, ROADMAP 233) so
// that the instrument a report cites is in the tree instead of in a gitignored scratch dir — the 2026-10-28 incident
// (docs/incidents/2026-10-28-cross-os-ledger-pruned-and-untracked-loss.md) lost eight instruments that were never
// committed. Provenance: byte-for-byte the same body as the spike file `.spike/gate/no-headers-timeout.mjs`, which stays
// where the first measurement was taken.
//
// Usage: node --import tools/model-probes/no-headers-timeout-shim.mjs tools/model-probes/gate.mjs <baseUrl> <model> ...
import http from "node:http";
import https from "node:https";

const realFetch = globalThis.fetch;

globalThis.fetch = function noHeadersTimeoutFetch(input, init = {}) {
  const url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : input?.url ? new URL(input.url) : null;
  if (!url || !/^https?:$/.test(url.protocol) || (init?.signal && init.signal.aborted)) return realFetch(input, init);
  if (init?.body && init.duplex) return realFetch(input, init); // streams: not this shim's problem
  const lib = url.protocol === "https:" ? https : http;
  const body = typeof init.body === "string" ? init.body : init.body == null ? undefined : Buffer.from(String(init.body));
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const req = lib.request(
      url,
      { method: init.method || "GET", headers: { ...(init.headers || {}), ...(body != null ? { "content-length": Buffer.byteLength(body) } : {}) } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            url: url.href,
            headers: new Headers(res.headers),
            text: async () => text,
            json: async () => JSON.parse(text),
            dtMs: Date.now() - t0, // visible to any caller that looks; gate.mjs times the call itself
          });
        });
        res.on("error", reject);
      }
    );
    req.setTimeout(0); // no idle socket ceiling — this IS the fix
    req.on("error", (e) => {
      e.message = `${e.message} (shim, after ${((Date.now() - t0) / 1000).toFixed(1)}s)`;
      reject(e);
    });
    if (body != null) req.write(body);
    req.end();
  });
};

console.log("[shim] global fetch replaced with node:http, req.setTimeout(0) — no 300 s headers ceiling");

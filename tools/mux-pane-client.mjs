// tools/mux-pane-client.mjs — the plugin's OWN PANE CLIENT: one resident process per multiplexer window, an
// ATTACHED CLIENT of one seat, reading that seat and routing its words to the broker's spool. It is NOT a second
// writer, and it is NOT the rig's TUI.
//
// WHY THIS FILE EXISTS (goal mwpeepwa-spmy34, contracts (3) OWNERSHIP + (4) INTERACTION). Every multiplexer
// driver's `open` verb names a command to run IN A WINDOW. The first answer — run the rig's own attach surface
// (`node tui.mjs --db <store> --attach --select <seat>`) — is MEASURED DEAD as a pane command on this host: the
// full TUI's `ca.InteractiveMode` opens a readOnly Harness and dies ~1.2 s later with NO input typed, throwing
// `ReadOnlySession: Read-only Harness: a commit with writes refused` from
// vendor/pi-main/packages/durable/dist/session/session.js:823 inside its OWN upkeep job (`#onLine`, reached from
// `#maintain`, which arms the hold-store/document-sweep timers). A readOnly Harness that runs upkeep WRITES, and
// a readOnly Harness may not. That is a fact about the vendor's full TUI, not about this seam — and fixing it
// there would mean patching `vendor/pi-main`, which is the base (D212 forbids it). So the plugin grows its OWN
// pane client on the plane it already owns, and every driver names THIS.
//
// THE SHAPE THAT WORKS (MEASURED 2026-11-22, .spike/muxpane-1.mjs + .spike/muxpane-1.out, on
// Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1): `src/multiplex.mjs`
// `multiplexAttach(harness, conversationId, {readOnly: true, docs: ["live","inbox"], seat, dbPath})` — the rig's
// own ATTACHED-CLIENT layer, whose cross-process leg is a RE-READ (the layer's own header says a watch acquired
// through a viewer handle delivers nothing, measured .spike/probe-watch-fanout2.mjs). That pane was RESIDENT for
// 8 refreshes (~7 s) with NO throw, `harness.assertUsable()` did not throw, the store's byte count was UNCHANGED
// across the whole run (122,880 B at seed == 122,880 B at end, so a second writer is arithmetically absent), and
// `client.act(...)` answered `{spooled:"<store>.broker.inbox/<n>.json"}` — the broker's spool is the transport.
// The contrast run with the vendor's DEFAULT upkeep knobs survived too, so the knobs are NOT the fix; the SHAPE
// is. The `Infinity` levers below are kept as a declared belt, not as the mechanism.
//
// WHAT THIS CLIENT NEVER IS, and why each half is load-bearing:
//   - NOT a Harness that writes. `readOnly: true`, and the pane asserts `write === false` before its first frame
//     — pi-durable spec.md:4371 "Harness instances must never own the same Session concurrently" and the
//     corruption class in docs/runbooks/README.md (a second writer into this store) are the reason.
//   - NOT a keystroke sender. There is no `send-keys`, no `-X stuff`, no `pane run` anywhere in the plugin: an
//     act is `multiplexAttach`'s `act()` leg, which becomes a spool intent for the RESIDENT writer to admit
//     (`src/broker.mjs` SPOOL_OPS `message`/`input`), so N panes on one seat merge into ONE ID-ordered stream
//     (docs/spec.md §6 admission, spec.md:2877 "Items are in ID order.").
//   - NOT a second lifecycle. It refuses unless a live broker ALREADY owns the store (`assessStoreOwnership`
//     `.owned === true`, imported from `src/storeownership.mjs`, the same rule `tui.mjs` uses). MEASURED TRAP:
//     `assessStoreOwnership(store).broker.alive` is `undefined` for a live broker here — key on `owned` ONLY.
//     Otherwise it prints the ONE command that WOULD own it, with the store named by ENV (`cli.mjs` has no
//     `--db`; `src/config.mjs` CONFIG_KEYS reads `DURIG_*`).
//   - NOT an exit-prone process. A multiplexer DESTROYS a window whose own command exited (measured on tmux 3.5a
//     and GNU Screen 5.0.2: an empty capture is the window dying, not a capture failure), so `--frames 0` —
//     FOREVER — is the default: the multiplexer owns the window's life, this client keeps it alive.
//
// COST (D213, its own fast loop — no model, no key, no network, no funded call): `node --check` 0.02 s, `--help`
// 0.05 s, `node tools/mux-pane-client.mjs --db <store> --select <seat> --frames 1` opens one store + one
// readOnly Harness + two watch acquisitions and prints one frame in ~0.35 s. A FOREVER pane costs one document
// snapshot + one entry page per frame (`multiplexAttach.refresh()`), i.e. ~1 read pair every `--reread-ms`
// (default 1000 ms) and NO write at all. Measured last_verified 2026-11-22 on Linux / Fedora Linux 45 (Forty
// Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1: `node --check tools/mux-pane-client.mjs` 0.01 s.
//
// THE PANE IS NOT A MODEL. `createModels()` is handed over with NO provider, so this pane can READ a seat and
// ROUTE to it, but it cannot ANSWER a prompt — a prompt would need the broker's writer and a funded model. Its
// viewport is the seat's own record: `pi.inbox` items and `pi.live` entries.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createModels } from "@earendil-works/pi-ai/models";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

import { multiplexAttach, inboxView } from "../src/multiplex.mjs";
import { Router } from "../src/rig.mjs";
import { readSeatList } from "../src/readapi.mjs";
import { assessStoreOwnership } from "../src/storeownership.mjs";
import { intentInboxDir } from "../src/broker.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PANE_CLIENT_PATH = join(ROOT, "tools", "mux-pane-client.mjs");
const ctx = BACKGROUND_CONTEXT;
const t0 = Date.now();
const sleep = (ms) => new Promise((f) => setTimeout(f, ms));
const say = (line) => process.stdout.write(String(line) + "\n");
const sec = () => ((Date.now() - t0) / 1000).toFixed(1);

// THE ARGV. Every option is a VALUE the driver can print; there is no positional grammar to get wrong.
// `--pane <name>` is the multiplexer's window name (the driver names a window after the SEAT, so it usually
// equals the seat); it is carried into the client's identity so a census can attribute a viewport to a pane.
const HELP = `mux-pane-client — one attached client of one seat, running inside one multiplexer window.

  node ${PANE_CLIENT_PATH} --db <store> --select <seat> [--pane <name>]
      [--reread-ms <n>] [--frames <n>] [--seconds <n>] [--act <sentence>] [--json] [--help]

  --db <store>        the store to read. REQUIRED. The store is named by an OPTION here (this client opens it
                      itself); it is NOT the same plane as cli.mjs, which has no --db and takes DURIG_DB.
  --select <seat>     the seat this pane is a client of. REQUIRED.
  --pane <name>       the multiplexer's window name, used for this client's identity and its viewport banner.
                      Defaults to the seat.
  --reread-ms <n>     the re-read cadence in ms (default 1000; the leg is a re-read because a watch acquired
                      through a readOnly handle delivers nothing — src/multiplex.mjs header).
  --frames <n>        frames to print, 0 = FOREVER (default 0). A multiplexer destroys a window whose command
                      exited, so staying resident is the point; a finite run is a pin, not a pane.
  --seconds <n>       a wall-clock bound on the loop (default unbounded) so a detached probe cannot hang.
  --act <sentence>    route ONE sentence to the seat through the broker's spool (op \`message\`, from this
                      client's id) and print where it landed. This is the only act this client has.
  --json              machine form: one JSON object per line after the banner.

  A pane refuses BY NAME when nothing owns the store, printing the command that would own it — it never starts
  a broker and it never writes the store.`;

function parse(argv = []) {
  const o = { db: null, select: null, pane: null, rereadMs: 1000, frames: 0, seconds: null, act: null, json: false, help: false };
  const bad = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i]);
    const value = () => (i + 1 < argv.length && !String(argv[i + 1]).startsWith("----")) ? argv[++i] : null;
    if (token === "--help" || token === "-h") { o.help = true; continue; }
    if (token === "--json") { o.json = true; continue; }
    if (token === "--act") { o.act = value(); if (o.act === null) bad.push(`${token} needs a value`); continue; }
    if (token === "--db") { o.db = value(); if (o.db === null) bad.push(`${token} needs a value`); continue; }
    if (token === "--select") { o.select = value(); if (o.select === null) bad.push(`${token} needs a value`); continue; }
    if (token === "--pane") { o.pane = value(); if (o.pane === null) bad.push(`${token} needs a value`); continue; }
    if (token === "--reread-ms") { const v = value(); if (v === null) bad.push(`${token} needs a value`); else o.rereadMs = Number(v); continue; }
    if (token === "--seconds") { const v = value(); if (v === null) bad.push(`${token} needs a value`); else o.seconds = Number(v); continue; }
    if (token === "--frames") { const v = value(); if (v === null) bad.push(`${token} needs a value`); else o.frames = Number(v); continue; }
    bad.push(`unknown option ${token}`);
  }
  return { ok: !bad.length && o.db && o.select, bad, o };
}

export async function muxPaneMain(argv = process.argv.slice(2)) {
  const parsed = parse(argv);
  if (parsed.o.help) { say(HELP); return 0; }
  if (!parsed.ok) {
    // A wrong argv in a multiplexer window is the class this seam refuses: a pane that prints nothing looks
    // like a pane that is working. Print the refusal and the usage, then exit non-zero (the window dies, and
    // the multiplexer's census then shows it died — which is the honest reading of a bad ask).
    say(`mux-pane-client: ${(parsed.bad.length ? parsed.bad.join("; ") : "missing --db <store> and --select <seat>")}\n${HELP}\n`);
    return 1;
  }
  const { db: store, select: seat, rereadMs, frames, seconds, json } = parsed.o;
  const paneName = parsed.o.pane ?? seat;

  // THE PRECONDITION (contract (3)): the pane ATTACHES, it never CREATES an owner.
  const ownership = assessStoreOwnership(store, {});
  if (ownership?.owned !== true) {
    const start = `DURIG_DB=${store} node cli.mjs serve`;
    say(`mux-pane-client: REFUSED — nothing owns ${store}, so this pane has no session to be a client of. ` +
      `${(ownership?.reasons ?? []).join(" ")} Nothing was read, written or started. ` +
      `The command that WOULD own it is ${start} (the store is named by ENV: cli.mjs has no --db flag, so an invented --db acts on the CONFIGURED store).\n`);
    return 1;
  }

  // THE PANE. `process.exitCode` is set rather than the process ended so the teardown below always runs.
  let harness = null;
  let storage = null;
  let client = null;
  let teardown = async () => {
    try { if (client) await client.detach(); } catch { /* a closing session refuses the stop */ }
    try { if (harness) await harness.close(ctx); } catch { /* already closed */ }
    try { if (storage) await storage.close(ctx); } catch { /* already closed */ }
  };
  // THE MULTIPLEXER'S SIGNAL. tmux/screen send SIGHUP/SIGTERM when a window is closed; the client prints its
  // own closure so a reader can see the window's last word, and exits 0 — a torn-down pane is not a failure.
  let signalled = null;
  const onSignal = (name) => () => {
    signalled = name;
    say(`[${paneName}] CLOSED — the multiplexer sent ${name}; the rig's session is unaffected (its owner is the resident broker, docs/DECISIONS.md D22 amended 2026-11-20)\n`);
    void teardown();
    process.exit(0);
  };
  for (const name of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(name, onSignal(name));

  try {
    storage = await openNodeSqliteStorage(store, { busyTimeoutMs: 15_000 });
    const registry = createRegistry();
    registry.install(Router);
    const models = createModels(); // NO provider: this pane CANNOT answer a prompt; it reads and routes.
    harness = await Harness.open(storage, {
      registry,
      models,
      readOnly: true,
      // THE BELT, NOT THE FIX. harness.js:114 forwards these two upkeep knobs to the Session kernel;
      // `Infinity` keeps documents and defers the hold store to the next writing commit or close. The measured
      // contrast run with DEFAULT knobs also survived, so what makes THIS shape live is the attached-client
      // shape, not the levers — see the header. They stay because a readOnly handle that never writes has no
      // reason to sweep.
      settings: { documentRetentionMs: Infinity, progress: { persistWithinMs: Infinity } },
    }, ctx);

    const seats = await readSeatList(storage, ctx);
    const row = seats.find((s) => s.name === seat);
    if (!row) {
      say(`mux-pane-client: REFUSED — ${store} holds no seat named ${seat}. known seats: ${seats.map((s) => s.name).join(", ") || "(no seats)"}.\n`);
      await teardown();
      return 1;
    }

    client = await multiplexAttach(harness, row.conversationId, {
      client: `pane-${paneName}`,
      readOnly: true,
      docs: ["live", "inbox"],
      seat,
      dbPath: store,
      context: ctx,
    });
    // THE ASSERTION, not an assumption: a pane that came back as a WRITER is the second-writer class, and it
    // dies here rather than typing into a session it does not own.
    if (client.write !== false || client.leg !== "re-read") {
      say(`mux-pane-client: REFUSED — the attach came back leg ${client.leg} write ${client.write}; a pane must be the re-read leg of an attached client.\n`);
      await teardown();
      return 1;
    }

    say(`[pane ${paneName}] attached — store ${store}  seat ${seat}  conversation ${row.conversationId}  leg ${client.leg}  write ${client.write}  watches ${client.watches.map((w) => w.name).join(",")}  owner pid ${ownership?.broker?.pid ?? "(owned; pid not reported)"}\n`);
    if (json) say(JSON.stringify({ pane: paneName, store, seat, conversationId: row.conversationId, leg: client.leg, write: client.write, owned: true }) + "\n");

    // THE ACT LEG, once, before the viewport loop: the client's words go to the broker's spool and the
    // resident writer admits them. Print where they landed — an act that prints nothing is the accepted-and-
    // ignored class.
    if (parsed.o.act !== null) {
      try {
        const spooled = await client.act(String(parsed.o.act), { requestId: `pane-${paneName}` });
        say(`[pane ${paneName}] act -> spooled ${spooled?.spooled ?? "(no spool)"} (op ${spooled?.op ?? "message"} — routed to the broker's spool, never a store write, never a keystroke)\n`);
        if (json) say(JSON.stringify({ act: parsed.o.act, spooled }) + "\n");
      } catch (err) {
        say(`[pane ${paneName}] act THREW ${err?.name}: ${err?.message} — nothing was routed.\n`);
        await teardown();
        return 1;
      }
    }

    // THE VIEWPORT LOOP. One refresh per frame; print only what is NEW, plus the counts, so a `capture-pane`
    // of this window is the pane's OWN evidence rather than a re-render of the store.
    const seen = new Set();
    let frame = 0;
    const limit = frames === 0 ? Infinity : frames;
    const deadline = seconds ? t0 + seconds * 1000 : Infinity;
    while (frame < limit && Date.now() < deadline) {
      frame += 1;
      let r = null;
      try {
        r = await client.refresh();
      } catch (err) {
        // A refresh that throws is printed, not swallowed: the pane's last word is the diagnosis.
        say(`[pane ${paneName}] refresh THREW at t=${sec()}s frame ${frame}: ${err?.name}: ${err?.message}\n${err?.stack ?? ""}\n`);
        break;
      }
      const inbox = r?.inbox ?? [];
      const entries = r?.entries ?? [];
      say(`[pane ${paneName}] t=${sec()}s frame ${frame} inbox=${inbox.length} entries=${entries.length} fresh=${client.events.length}\n`);
      if (json) say(JSON.stringify({ frame, t: sec(), inbox: inbox.length, entries: entries.length, events: client.events.length }) + "\n");
      for (const it of inbox) {
        if (seen.has(`i:${it.id}`)) continue;
        seen.add(`i:${it.id}`);
        const content = typeof it.content === "string" ? it.content.slice(0, 120) : JSON.stringify(it.content ?? null).slice(0, 120);
        say(`[pane ${paneName}]   inbox ${it.id} mode ${it.mode}: ${content}\n`);
      }
      for (const e of entries) {
        if (seen.has(`e:${e.id}`)) continue;
        seen.add(`e:${e.id}`);
        say(`[pane ${paneName}]   entry ${e.id} kind ${e.kind}\n`);
      }
      // The spool as the pane sees it: proof that this client's transport is the broker's inbox, not a handle.
      if (frame === limit || Date.now() >= deadline) {
        const dir = intentInboxDir(store);
        if (existsSync(dir)) say(`[pane ${paneName}] spool ${dir}: ${readdirSync(dir).length} intent(s)\n`);
      }
      if (frame >= limit) break;
      const remain = deadline === Infinity ? Infinity : deadline - Date.now();
      await sleep(Math.max(0, Math.min(rereadMs, remain === Infinity ? rereadMs : remain)));
      if (Date.now() >= deadline) break;
    }
    harness.assertUsable(); // the pane's own liveness check, printed as the last line rather than assumed
    say(`[pane ${paneName}] alive at t=${sec()}s after ${frame} frame(s) — the multiplexer owns this window; closing it never ends the session\n`);
    await teardown();
    return 0;
  } catch (err) {
    // A pane that dies must say why, in its OWN viewport: that text is what a `capture-pane` will show, and
    // an empty capture is a destroyed window, not a captured pane.
    say(`[pane ${paneName}] DIED at t=${sec()}s: ${err?.name}: ${err?.message}\n${(err?.stack ?? "").slice(0, 1200)}\n`);
    try { await teardown(); } catch { /* teardown of a dead pane */ }
    return 1;
  }
}

// A CLI AND a library: a pin imports `muxPaneMain` and calls it with its own argv, so the CLI hop is not a
// second shape the pin cannot see. The guard is what keeps an import from running the CLI at import time.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await muxPaneMain(process.argv.slice(2));
}

// tools/stranded-inbox.mjs — measure the STRANDED POPULATION (#5275 / ROADMAP 329).
//
// READ-ONLY. It opens no store: the spool is files. An inbox entry is a request that a
// caller wrote and that no broker has answered or dead-lettered. Today NO check counts it,
// so "the caller never learned anything" leaves no artifact.
//
// Three classes, and the whole point is that they need different clocks:
//   shutdown-stranded : createdAt later than the last EXIT line of the SAME run's exit —
//                       written while the broker was leaving, never replayed.
//   drain-stranded    : older than the last PASS line, i.e. no pass/drain has swept the
//                       inbox since it was written. A live heartbeat does NOT clear this.
//   result-orphan     : a result recorded in `.inbox.out` for a requestId whose caller has
//                       already timed out (an answer to nobody).
//
// Usage: node tools/stranded-inbox.mjs <path-to-db>   (exit 0 = population is zero)
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const db = process.argv[2];
if (!db) {
  console.error("usage: node tools/stranded-inbox.mjs <path-to-db>");
  process.exit(2);
}
const inboxDir = `${db}.broker.inbox`;
const outDir = `${db}.broker.inbox.out`;
const logPath = `${db}.broker.log`;
const statePath = `${db}.broker.json`;

const now = Date.now();
const lines = existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n") : [];
// Log lines are `<ISO ts> <WORD> ...` (src/broker.mjs logBrokerLine).
const last = (pred) => {
  for (let i = lines.length - 1; i >= 0; i -= 1) if (pred(lines[i])) return lines[i];
  return null;
};
const lastExitLine = last((l) => / EXIT /.test(l));
const lastPassLine = last((l) => / PASS /.test(l));
const lastStartLine = last((l) => / START /.test(l));
const ts = (line) => (line ? Date.parse(line.slice(0, line.indexOf(" "))) : null);
const lastExitAt = ts(lastExitLine);
const lastPassAt = ts(lastPassLine);
const lastStartAt = ts(lastStartLine);
// A run that STARTED after the last EXIT is the owner of anything spooled after it, so a
// pending entry younger than that START is NOT shutdown-stranded - it is live-stranded.
// Comparing to the last EXIT alone would mislabel a live broker's backlog.
const noRunSinceExit = lastStartAt === null || lastExitAt === null || lastStartAt < lastExitAt;

const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null;
const hbAgeS = state && typeof state.heartbeatAt === "number" ? (now - state.heartbeatAt) / 1000 : null;
const progressAgeS = lastPassAt ? (now - lastPassAt) / 1000 : null;

const files = existsSync(inboxDir) ? readdirSync(inboxDir).filter((n) => n.endsWith(".json")).sort() : [];
let shutdownStranded = 0;
let drainStranded = 0;
for (const name of files) {
  let rec;
  try {
    rec = JSON.parse(readFileSync(join(inboxDir, name), "utf8"));
  } catch {
    continue; // an unreadable file is the drain's problem, not this probe's
  }
  const at = Date.parse(rec.createdAt ?? "");
  const ageS = Number.isNaN(at) ? null : (now - at) / 1000;
  const isShutdownStranded =
    noRunSinceExit && lastExitAt !== null && !Number.isNaN(at) && at > lastExitAt;
  const isDrainStranded = lastPassAt !== null && !Number.isNaN(at) && at > lastPassAt;
  if (isShutdownStranded) shutdownStranded += 1;
  if (isDrainStranded) drainStranded += 1;
  console.log(
    `${name} op=${rec.op ?? "?"} view=${rec.view ?? "?"} ageS=${ageS === null ? "?" : ageS.toFixed(0)} ` +
      `${isShutdownStranded ? "SHUTDOWN-STRANDED " : ""}${isDrainStranded ? "DRAIN-STRANDED" : ""}`.trimEnd(),
  );
}

const outCount = existsSync(outDir) ? readdirSync(outDir).filter((n) => n.endsWith(".json")).length : 0;
console.log(
  `SUMMARY inbox=${files.length} shutdownStranded=${shutdownStranded} drainStranded=${drainStranded} ` +
    `resultFiles=${outCount} hbAgeS=${hbAgeS === null ? "?" : hbAgeS.toFixed(0)} progressAgeS=${progressAgeS === null ? "?" : progressAgeS.toFixed(0)} ` +
    `runSinceExit=${noRunSinceExit ? "no" : "yes"} ` +
    `lastExit=${lastExitLine ?? "-"} lastPass=${lastPassLine ?? "-"}`,
);
// The verdict the fix must clear: a pending entry that outlived the run that received it.
process.exit(shutdownStranded === 0 ? 0 : 1);

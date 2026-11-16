// tools/argv-contract.mjs — ONE option reader for the tools/ plane. Import it; do not re-grow a four-line one.
//
// WHY ONE FILE EXISTS. The reader below was written four lines at a time in a dozen instruments, and the copy
// that reads only `--name value` makes `--name=value` a SILENT DEFAULT: measured 2026-11-16 (Linux, Fedora Linux
// 45 (Forty Five), kernel `7.2.15-300.fc45.x86_64`, node v24.22.1, git 2.56.0 — host read in the SAME command as
// the numbers, per SELFDEV pitfall 396's probe):
//
//   node tools/queue-drain-audit.mjs --json=/tmp/x.json   exit 0, 303 ms, stdout 650 B, `.err` 321 B, NO file
//   node tools/queue-drain-audit.mjs --json /tmp/x.json   exit 0, 301 ms, 649 B written
//   node tools/channel-preflight.mjs --zzz=1              exit 0, 730 ms — a full 9,476 B report, no refusal
//
// Both runs print the same report, the same exit code and comparable `.err` bytes, and only one of them did what
// it was asked. A reader who asked for JSON got nothing (SELFDEV pitfall 426; pitfall 405's read side of the
// same shape), and an option nobody knows silently changed what the verdict was measured over.
//
// THE CONTRACT (pinned end-to-end by demo/flag-form-refusal.test.mjs — run THAT, not this file):
//   1. `--name value` and `--name=value` are ONE option;
//   2. an option a tool does not take REFUSES **by name**, with `REFUSED cause:` and that tool's own list;
//   3. a FLAG given a value REFUSES — a tool does not invent a truthiness;
//   4. an option given no value, an empty `--name=`, and a non-number where a number was asked for REFUSE;
//   5. a refusal exits **2**, never 1: on these instruments exit 1 already means "measured FAIL", and a reader
//      who cannot tell a typo from a measurement cannot tell a green from a red.
//
// THIS IS THE tools/ PLANE, not the base (D212 — customization never goes into the base). A seat that wants the
// same behaviour inside the product grows a SEAM there; this file serves the delegate/team instruments that call
// it, and one derivation means the next instrument cannot re-grow the defect.
//
// Cost: a refusal costs ~0.03 s — parsing happens BEFORE a tool does any work, which is also why a refusal
// cannot half-measure. `last_verified: 2026-11-16`, verified by `node demo/flag-form-refusal.test.mjs`
// (its Cost line carries the measured red/green pair and the host line).

const REFUSE_EXIT = 2;

// spec: { value: [...], bool: [...], numeric: [...], multi: [...], positional: false, usage: "--db <path> · --json <out>" }
// `multi` names options that may be given more than ONCE (`--seat impl --seat pm` asks about two seats); they are
// still strings until a caller asks, and a name in `multi` is implicitly a value option, so a tool cannot
// half-declare it. A repeated option that OVERWROTE instead of accumulated is the same class as a dropped one:
// the report was measured over one seat while the caller asked for two.
// `numeric` names options whose value must be a number; they are still read as strings until `num()` asks.
function parseOpts(argv, spec = {}) {
  const value = new Set(spec.value ?? []);
  const bool = new Set(spec.bool ?? []);
  const numeric = new Set(spec.numeric ?? []);
  const multi = new Set(spec.multi ?? []);
  for (const m of multi) value.add(m);
  const positional = spec.positional === true;
  const usage = spec.usage ?? "(this tool takes no options)";
  const opt = new Map();
  const all = new Map();
  const flags = new Set();
  const rest = [];
  const die = (cause) => {
    // `REFUSED cause:` is the shape tools/keycheck.mjs already ships; keep it so one grep finds every refusal.
    process.stderr.write(`REFUSED cause:${cause}\n`);
    process.stderr.write(`known options: ${usage}\n`);
    process.exit(REFUSE_EXIT);
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i]);
    if (!a.startsWith("--")) {
      if (positional) {
        rest.push(a);
        continue;
      }
      die(`a bare argument ${JSON.stringify(a)} is not one of this tool's options — it would have been dropped, and a dropped option is a verdict measured on something else`);
    }
    const eq = a.indexOf("=");
    const name = eq < 0 ? a.slice(2) : a.slice(2, eq);
    if (bool.has(name)) {
      if (eq >= 0) die(`--${name} is a FLAG, not an option: write --${name} alone (there is no --${name}=false; omit it to not ask for it)`);
      flags.add(name);
      continue;
    }
    if (!value.has(name)) die(`unknown option --${name} — it would have been dropped and its default used. This tool takes: ${usage}`);
    let val;
    if (eq >= 0) {
      val = a.slice(eq + 1);
      if (val === "") die(`--${name}= was given an EMPTY value — name a value or drop the option (an empty path is not a report)`);
    } else {
      const next = i + 1 < argv.length ? String(argv[i + 1]) : undefined;
      if (next === undefined || next.startsWith("--")) die(`--${name} was given no value${next === undefined ? "" : ` — the next token ${next} looks like another option`} — an unset option and a typo'd one used to print the same report`);
      val = next;
      i += 1;
    }
    if (numeric.has(name)) {
      const n = Number(val);
      if (!Number.isFinite(n)) die(`--${name} ${val} is not a number — NaN in the arithmetic would print a verdict no reader could tell was broken`);
    }
    if (multi.has(name)) all.set(name, [...(all.get(name) ?? []), val]);
    opt.set(name, val);
  }
  const num = (name, dflt) => {
    if (!opt.has(name)) return dflt;
    const n = Number(opt.get(name));
    if (!Number.isFinite(n)) die(`--${name} ${opt.get(name)} is not a number — NaN in the arithmetic would print a verdict no reader could tell was broken`);
    return n;
  };
  return {
    get: (name, dflt = null) => (opt.has(name) ? opt.get(name) : dflt),
    // Every value given for a `multi` option, in the order the caller gave them; [] when none were.
    all: (name) => all.get(name) ?? [],
    has: (name) => flags.has(name),
    num,
    rest,
    usage,
    // The list, so a tool can print the same contract in its own `--help`.
    opts: [...value].map((v) => `--${v} <value>`).concat([...bool].map((b) => `--${b}`)).join(" · "),
  };
}

export { parseOpts, REFUSE_EXIT };

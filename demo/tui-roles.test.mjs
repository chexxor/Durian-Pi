// demo/tui-roles.test.mjs — U4: tool/non-agent surfaces use DISTINCT bg+fg per pi's
// theme roles; the TUI never colours by hue alone and never invents a palette.
//
// GROUNDING (this checkout, verified by search):
// - `<pi-coding-agent>` (docs/themes.md, dist/.../theme/dark.json+light.json,
//   tool-execution.js) is NOT vendored here. pi-tui@1.1.0 IS vendored: its components
//   take per-role theme FUNCTIONS (e.g. SettingsListTheme.label/value/description),
//   the contract durig's TUI mirrors.
// - pi's role NAMES are already adopted in durig as a theme-token DECISION:
//   docs/RESEARCH.md "Tool backgrounds are a theme token | pi: toolPendingBg,
//   toolSuccessBg, toolErrorBg | opt-in --tool-bg with --theme dark|light",
//   implemented in src/chatview.mjs (TOOL_BG 48;5;236 dark / 48;5;253 light, opt-in).
//
// ONE concern: the TUI's live tool rows join the SAME token system — role-named
// (toolPendingBg/toolSuccessBg/toolErrorBg/toolTitle/toolOutput), theme-switchable
// (dark/light), opt-in with NO_COLOR/untinted default — distinct from the agent's
// prose rows, and success/failure never encoded by hue alone (glyphs differ).
// Values are DERIVATIONS on durig's existing tint ramp (236/253 base family),
// disclosed as such; no new hue family and no hard-coded automatic tint.
//
// Failing-first: the current TUI tints nothing (fg glyphs only) → the role assertions
// FAIL (RED); after the themed render they pass (GREEN).
// Run: node demo/tui-roles.test.mjs  (exit 0 = pass)

import { renderTui } from "../src/tui/client.mjs";
import { themeToolRoles, TOOL_BG, THEME_ROLES } from "../src/chatview.mjs";

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else { failures += 1; console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`); }
}

const seats = [{ name: "impl", role: "implementation engineer" }];
const health = { seats, queueItems: [], attention: [], uptime: 600 };

function livePartial(status, extra = {}) {
  return {
    hasContent: true,
    text: "",
    thinking: "",
    tools: [],
    toolCalls: [{
      callId: "call-1",
      name: "read_file",
      args: { path: "src/broker.mjs" },
      status,
      output: status === "done" ? "ok" : undefined,
      isError: extra.isError ?? false,
      ...extra,
    }],
  };
}

try {
  console.log("\n=== U4: theme roles on TUI tool/non-agent surfaces ===\n");

  // --- 1. The token system: role names exist per theme, values distinct -------
  check("THEME_ROLES names pi's tool roles",
    ["toolPendingBg", "toolSuccessBg", "toolErrorBg", "toolTitle", "toolOutput"]
      .every((r) => THEME_ROLES.dark[r] !== undefined && THEME_ROLES.light[r] !== undefined),
    JSON.stringify(Object.keys(THEME_ROLES.dark ?? {})));
  check("roles are DISTINCT within a theme (pending ≠ success ≠ error bg)",
    THEME_ROLES.dark.toolPendingBg !== THEME_ROLES.dark.toolSuccessBg &&
    THEME_ROLES.dark.toolPendingBg !== THEME_ROLES.dark.toolErrorBg &&
    THEME_ROLES.dark.toolSuccessBg !== THEME_ROLES.dark.toolErrorBg);
  check("dark ≠ light", TOOL_BG.dark !== TOOL_BG.light);
  check("chatview's existing tint is the pending token (log's decision kept)",
    THEME_ROLES.dark.toolPendingBg === TOOL_BG.dark && THEME_ROLES.light.toolPendingBg === TOOL_BG.light);
  check("themeToolRoles(theme) resolves per theme",
    themeToolRoles("dark").toolPendingBg === THEME_ROLES.dark.toolPendingBg &&
    themeToolRoles("light").toolSuccessBg === THEME_ROLES.light.toolSuccessBg);

  // --- 2. Frames: tinted tool rows when theme is passed ----------------------
  for (const themeName of ["dark", "light"]) {
    const frame = renderTui({
      seats, turns: [], partial: livePartial("running"), health, queueItems: [],
      width: 80, color: true, theme: themeName, toolBg: true,
    });
    const colored = frame.lines.join("\n");
    const wanted = THEME_ROLES[themeName].toolPendingBg;
    check(`${themeName}: running tool row carries toolPendingBg`, colored.includes(wanted), wanted);
  }
  const doneDark = renderTui({
    seats, turns: [], partial: livePartial("done"), health, queueItems: [],
    width: 80, color: true, theme: "dark", toolBg: true,
  });
  check("done tool row carries toolSuccessBg (distinct from pending)",
    doneDark.lines.join("\n").includes(THEME_ROLES.dark.toolSuccessBg));
  const failedFrame = renderTui({
    seats, turns: [], partial: livePartial("done", { isError: true }), health, queueItems: [],
    width: 80, color: true, theme: "dark", toolBg: true,
  });
  check("error tool row carries toolErrorBg (distinct from success)",
    failedFrame.lines.join("\n").includes(THEME_ROLES.dark.toolErrorBg));

  // --- 3. Default stays untinted; NO_COLOR honoured (hue never alone) --------
  const plain = renderTui({ seats, turns: [], partial: livePartial("running"), health, queueItems: [], width: 80, color: true });
  check("untinted by default even when colour is on", !plain.lines.join("\n").includes("\x1b[48;5;"));
  const tintOff = renderTui({ seats, turns: [], partial: livePartial("done"), health, queueItems: [], width: 80, color: true, theme: "dark" });
  check("toolBg unset → no tool backgrounds (chatview's opt-in rule)", !tintOff.lines.join("\n").includes("\x1b[48;5;"));

  // --- 4. Glyphs never rely on hue alone -------------------------------------
  const runLines = (() => { const f = renderTui({ seats, turns: [], partial: livePartial("running"), health, queueItems: [], width: 80, color: true, theme: "dark", toolBg: true }); return frameToLinesSafe(f); })();
  const doneLines = (() => { const f = renderTui({ seats, turns: [], partial: livePartial("done"), health, queueItems: [], width: 80, color: true, theme: "dark", toolBg: true }); return frameToLinesSafe(f); })();
  const failLines = (() => { const f = renderTui({ seats, turns: [], partial: livePartial("done", { isError: true }), health, queueItems: [], width: 80, color: true, theme: "dark", toolBg: true }); return frameToLinesSafe(f); })();
  check("pending/running glyph ↔ (differs from ✓)", runLines.some((l) => l.includes("↻")));
  check("done glyph ✓ (differs from ↻)", doneLines.some((l) => l.includes("✓")));
  check("error glyph ✗ (differs from ✓)", failLines.some((l) => l.includes("✗")));

  console.log(failures === 0
    ? "\nPASS — tool surfaces themed per pi's role vocabulary; opt-in; hue never alone"
    : `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
  console.error("ERROR:", err?.message?.slice(0, 400) ?? err);
  failures += 1;
}

function frameToLinesSafe(frame) {
  // import-free local: reuse frameToLines from client via a lazy import trick is
  // not needed — strip ANSI inline.
  return frame.lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
}

process.exit(failures === 0 ? 0 : 1);

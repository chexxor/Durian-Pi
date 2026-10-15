// demo/cli-help.test.mjs — C5: --help flag and help subcommand.
//
// `node cli.mjs --help` prints USAGE to stderr, exit 0, stdout empty.
// `node cli.mjs help` same contract.
// Unknown commands still produce JSON on stdout, exit 2.
//
// Run: node demo/cli-help.test.mjs  (exit 0 = pass)

import { spawn } from "node:child_process";
import { promisify } from "node:util";

function runCli(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["cli.mjs", ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => { stdout += d; });
    p.stderr.on("data", (d) => { stderr += d; });
    p.on("close", (code) => resolve({ code, stdout, stderr }));
    p.on("error", reject);
  });
}

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

try {
  console.log("\n=== C5: help flag and subcommand ===\n");

  // Test 1: --help prints usage to stderr, empty stdout, exit 0
  const helpFlag = await runCli(["--help"]);
  check("--help exit 0", helpFlag.code === 0);
  check("--help stdout empty", helpFlag.stdout.trim() === "", `"${helpFlag.stdout.slice(0, 50)}"`);
  check("--help stderr has USAGE", helpFlag.stderr.includes("node cli.mjs up"), helpFlag.stderr.slice(0, 50));

  // Test 2: help subcommand same contract
  const helpCmd = await runCli(["help"]);
  check("help subcommand exit 0", helpCmd.code === 0);
  check("help subcommand stdout empty", helpCmd.stdout.trim() === "", `"${helpCmd.stdout.slice(0, 50)}"`);
  check("help subcommand stderr has USAGE", helpCmd.stderr.includes("node cli.mjs up"), helpCmd.stderr.slice(0, 50));

  // Test 3: unknown command still produces JSON on stdout
  const unknown = await runCli(["some-bogus-command"]);
  check("unknown command exit non-zero", unknown.code !== 0);
  const json = JSON.parse(unknown.stdout.trim());
  check("unknown command JSON on stdout", json.ok === false);
  check("unknown command stdout empty stderr", unknown.stderr.trim() === "", unknown.stderr);

  console.log(failures === 0
    ? "\nPASS — C5 help verified"
    : `\nFAIL — ${failures} check(s) failed`);
} catch (err) {
  console.error("ERROR:", err.message?.slice(0, 500));
  failures += 1;
}

process.exit(failures === 0 ? 0 : 1);

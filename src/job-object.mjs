// src/job-object.mjs — Windows Job Object for process-tree reaping.
//
// PURPOSE: Windows has no SIGTERM. Seats spawn processes inside a Windows
// Job Object created with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE so the entire
// process tree dies when the seat's handle closes. After cleanup, the
// worktree is only removed once the tree is confirmed dead.
//
// Uses PowerShell P/Invoke (Add-Type) to call kernel32.dll functions.
//
// CRITICAL: The JOBOBJECT_EXTENDED_LIMIT_INFORMATION struct must be sent at
// the exact size the kernel expects for this Windows version.
// Scanned sizes 16..256 for infoClass 1 and 9; only infoClass=9, sz=144
// succeeded on Win10 19045.
// The kernel struct layout (144 bytes):
//   JOBOBJECT_BASIC_LIMIT_INFORMATION at offset 0 (64 bytes)
//   IO_COUNTERS at offset 64 (48 bytes)
//   ProcessMemoryLimit at offset 112 (8 bytes)
//   JobMemoryLimit at offset 120 (8 bytes)
//   PeakProcessMemoryUsed at offset 128 (8 bytes)
//   PeakJobMemoryUsed at offset 136 (8 bytes)
// Total: 144 bytes

import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const isWindows = process.platform === "win32";
const execFileP = promisify(execFile);

/** Report a best-effort cleanup failure without masking the primary outcome. */
function reportCleanupError(what, err) {
	console.warn(`job-object: ${what} failed: ${err?.message ?? err}`);
}

/**
 * Run a PowerShell script and return { stdout, stderr, code }.
 * Uses PowerShell 7+ (pwsh) if available, falls back to Windows PowerShell.
 */
async function runPS(script) {
	const psPath = (await execFileP("where", ["pwsh"], { encoding: "buffer" }).then(() => "pwsh").catch(() => "powershell")).trim().replace(/"/g, "");
	return execFileP(psPath, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
		timeout: 15000,
		encoding: "utf8",
	});
}

/**
 * Create and return a Job Object with KILL_ON_JOB_CLOSE set.
 * Returns { jobHandle: string } on success.
 */
async function createJobObject(name) {
	if (!isWindows) {
		return { jobHandle: null };
	}

	const workDir = await mkdtemp(join(tmpdir(), "durig-job-"));
	const ps1 = join(workDir, "create-job.ps1");

	const psScript = [
		"Add-Type -TypeDefinition @'",
		"using System;using System.Runtime.InteropServices;",
		"public class JobApi {",
		"    [DllImport(\"kernel32.dll\", SetLastError=true)]",
		"    public static extern IntPtr CreateJobObject(IntPtr a, string name);",
		"    [DllImport(\"kernel32.dll\", SetLastError=true)]",
		"    public static extern bool SetInformationJobObject(IntPtr h, int infoClass, IntPtr ptr, int sz);",
		"    [DllImport(\"kernel32.dll\", SetLastError=true)]",
		"    public static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);",
		"    [DllImport(\"kernel32.dll\", SetLastError=true)]",
		"    public static extern bool TerminateJobObject(IntPtr j, uint exit);",
		"    [DllImport(\"kernel32.dll\", SetLastError=true)]",
		"    public static extern bool CloseHandle(IntPtr h);",
		"    public const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;",
		"    public const int JOBOBJECT_EXTENDED_LIMIT_INFORMATION = 9;",
		"    public const int JOBOBJECT_ELI_SIZE = 144;",
		"",
		"    public static IntPtr Create(string name) {",
		"        IntPtr h = CreateJobObject(IntPtr.Zero, name);",
		"        if (h == IntPtr.Zero) {",
		"            int err = Marshal.GetLastWin32Error();",
		"            throw new System.ComponentModel.Win32Exception(err, \"CreateJobObject failed\");",
		"        }",
		"",
		"        // Build JOBOBJECT_EXTENDED_LIMIT_INFORMATION as raw bytes (144 bytes).",
		"        // LimitFlags (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE) at offset 16.",
		"        byte[] buf = new byte[144];",
		"        buf[16] = 0x00; buf[17] = 0x20; buf[18] = 0x00; buf[19] = 0x00;",
		"",
		"        IntPtr ptr = Marshal.AllocHGlobal(144);",
		"        try {",
		"            Marshal.Copy(buf, 0, ptr, 144);",
		"            if (!SetInformationJobObject(h, 9, ptr, 144)) {",
		"                int err = Marshal.GetLastWin32Error();",
		"                Marshal.FreeHGlobal(ptr);",
		"                throw new System.ComponentModel.Win32Exception(err, \"SetInfo failed err=\" + err);",
		"            }",
		"        } finally { Marshal.FreeHGlobal(ptr); }",
		"        return h;",
		"    }",
		"    public static void Assign(IntPtr job, IntPtr proc) {",
		"        if (!AssignProcessToJobObject(job, proc))",
		"            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());",
		"    }",
		"    public static bool Release(IntPtr h) { return CloseHandle(h); }",
		"}",
		"'@ -ErrorAction Stop",
		"",
		"try {",
		"    $h = [JobApi]::Create($args[0])",
		"    Write-Output $h",
		"    exit 0",
		"} catch {",
		"    Write-Error $_",
		"    exit 1",
		"}",
	].join("\n");

	writeFileSync(ps1, psScript);

	const { stdout, stderr, code } = await execFileP("powershell", [
		"-NoProfile",
		"-ExecutionPolicy",
		"Bypass",
		"-File",
		ps1,
		name,
	], { cwd: workDir, timeout: 10000, encoding: "utf8" });

	// Clean up the temp dir immediately — we only needed the script file.
	try {
		await rm(workDir, { recursive: true, force: true });
	} catch (err) {
		reportCleanupError("removing the create-job temp dir", err);
	}

	if (code !== 0) {
		throw new Error(`Job object creation failed: ${stderr}`);
	}

	// Parse the handle from output. PowerShell outputs the IntPtr as its hex string.
	return { jobHandle: stdout.trim() };
}

/**
 * Spawn a command inside a Windows Job Object.
 * On non-Windows, just calls spawn() with no-op cleanup.
 *
 * Returns { child, pid, cleanup } — cleanup() closes the job handle,
 * which triggers KILL_ON_JOB_CLOSE on Windows.
 */
export async function spawnInJob(cmd, args = [], opts = {}) {
	if (!isWindows) {
		const child = spawn(cmd, args, {
			cwd: opts.cwd || process.cwd(),
			env: opts.env || process.env,
			stdio: opts.stdio || "inherit",
			shell: opts.shell || false,
		});
		return { child, pid: child.pid, cleanup: async () => child.kill() };
	}

	// ---- Windows: PowerShell P/Invoke wrapper ----
	const workDir = await mkdtemp(join(tmpdir(), "durig-job-"));
	const ps1 = join(workDir, "run.ps1");
	writeFileSync(ps1, [
		"Add-Type -TypeDefinition @'",
		"using System;using System.Runtime.InteropServices;using System.Diagnostics;",
		"public class JobApi {",
		"    [DllImport(\"kernel32.dll\", SetLastError=true)]",
		"    public static extern IntPtr CreateJobObject(IntPtr a, string name);",
		"    [DllImport(\"kernel32.dll\", SetLastError=true)]",
		"    public static extern bool SetInformationJobObject(IntPtr h, int info, IntPtr ptr, int sz);",
		"    [DllImport(\"kernel32.dll\", SetLastError=true)]",
		"    public static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);",
		"    [DllImport(\"kernel32.dll\", SetLastError=true)]",
		"    public static extern bool TerminateJobObject(IntPtr j, uint exit);",
		"    [DllImport(\"kernel32.dll\", SetLastError=true)]",
		"    public static extern bool CloseHandle(IntPtr h);",
		"    public const uint KILL_ON_CLOSE = 0x2000;",
		"    public static IntPtr Create(string name) {",
		"        IntPtr h = CreateJobObject(IntPtr.Zero, name);",
		"        if (h == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());",
		"        byte[] buf = new byte[144];",
		"        buf[16]=0;buf[17]=0x20;buf[18]=0;buf[19]=0;",
		"        IntPtr ptr = Marshal.AllocHGlobal(144);",
		"        try { Marshal.Copy(buf, 0, ptr, 144);",
		"            if (!SetInformationJobObject(h, 9, ptr, 144)) {",
		"                int err = Marshal.GetLastWin32Error(); Marshal.FreeHGlobal(ptr);",
		"                throw new System.ComponentModel.Win32Exception(err, \"SetInfo err=\"+err);",
		"            }",
		"        } finally { Marshal.FreeHGlobal(ptr); }",
		"        return h;",
		"    }",
		"    public static void Assign(IntPtr j, IntPtr p) {",
		"        if (!AssignProcessToJobObject(j, p)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());",
		"    }",
		"    public static bool Release(IntPtr h) { return CloseHandle(h); }",
		"}",
		"'@ -ErrorAction Stop",
		"",
		"$jobName = $args[0]",
		"$cmd = $args[1]",
		"$cmdArgs = $args[2..99]",
		"",
		"$hJob = [JobApi]::Create($jobName)",
		"",
		"$psi = New-Object System.Diagnostics.ProcessStartInfo",
		"$psi.FileName = $cmd",
		"$psi.Arguments = ($cmdArgs -join ' ')",
		"$psi.UseShellExecute = $false",
		"$psi.CreateNoWindow = $true",
		"$psi.WorkingDirectory = (Get-Location).Path",
		"",
		"$proc = [System.Diagnostics.Process]::Start($psi)",
		"[JobApi]::Assign($hJob, $proc.Handle)",
		"Write-Output $proc.Id",
		"Flush",
		"",
		"# Keep the handle alive while the process runs.",
		"# The parent kills us to signal cleanup.",
		"while ($true) {",
		"    Start-Sleep -Milliseconds 500",
		"    if ($proc.HasExited) { break }",
		"}",
		"",
		"# Cleanup: terminate job, release handle",
		"[JobApi]::Terminate($hJob)",
		"[JobApi]::Release($hJob) | Out-Null",
	].join("\n"));

	const child = spawn("powershell.exe", [
		"-NoProfile",
		"-ExecutionPolicy",
		"Bypass",
		"-File",
		ps1,
		"DurigSeat",
		cmd,
		...args,
	], {
		shell: true,
		cwd: opts.cwd || process.cwd(),
		env: { ...process.env },
	});

	let resolved = false;
	const timeout = setTimeout(() => {
		if (!resolved) {
			try { child.kill(); } catch (err) { reportCleanupError("killing the timed-out job helper", err); }
		}
	}, 15000);

	const pidPromise = new Promise((resolve, reject) => {
		let pidStr = "";
		child.stdout?.on("data", (d) => {
			if (resolved) return;
			pidStr += d.toString();
			const lines = pidStr.split("\n");
			const pidLine = lines.find((l) => /^\d+$/.test(l.trim()));
			if (pidLine) {
				resolved = true;
				clearTimeout(timeout);
				resolve(Number(pidLine.trim()));
			}
		});
		child.stderr?.on("data", () => {}); // discard errors
		child.on("exit", (code) => {
			if (!resolved) {
				clearTimeout(timeout);
				reject(new Error(`Job helper exited with code ${code}`));
			}
		});
	});

	const cleanup = async () => {
		let childPid = -1;
		try { childPid = await pidPromise; } catch (err) { reportCleanupError("awaiting the job helper pid during cleanup", err); }

		// Kill the PowerShell helper (closes job handle -> KILL_ON_JOB_CLOSE triggers)
		try { child.kill(); } catch (err) { reportCleanupError("killing the job helper", err); }

		// Give the job time to propagate the kill to children.
		await new Promise((r) => setTimeout(r, 1000));

		// Backup: taskkill specific PIDs if still alive
		if (childPid > 0) {
			try {
				await execFileP("taskkill", ["/F", "/T", "/PID", String(childPid)], { timeout: 5000 });
			} catch (err) {
				reportCleanupError("taskkill of the job helper pid", err);
			}
		}

		try { await rm(workDir, { recursive: true, force: true }); } catch (err) { reportCleanupError("removing the spawn temp dir", err); }
	};

	try {
		const pid = await pidPromise;
		return { child, pid, cleanup };
	} catch (err) {
		try { child.kill(); } catch (killErr) { reportCleanupError("killing the job helper after failure", killErr); }
		throw err;
	}
}

/**
 * Wait until the given PID is no longer alive.
 * @param {number} pid
 * @param {number} timeoutMs — default 15000
 * @returns {Promise<boolean>} true if dead, false if timed out
 */
export async function waitForProcessDeath(pid, timeoutMs = 15000) {
	if (!pid) return true;
	if (!isWindows) {
		try {
			process.kill(pid, 0);
			await new Promise((r) => setTimeout(r, 100));
			return false;
		} catch {
			return true;
		}
	}

	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const { stdout } = await execFileP("tasklist", [
				"/FI", `PID eq ${pid}`,
				"/NH", "/FO", "CSV",
			], { timeout: 1000 });
			if (!stdout.includes(`"${pid}"`)) return true;
		} catch {
			return true; // tasklist error → process gone
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	return false;
}

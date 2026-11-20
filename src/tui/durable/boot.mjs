// Compose a durable-backed runtime for a smoke run or a test: a faux model on
// the durable side (so no network), and a temp cwd/agentDir for the host shell.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDurableTuiRuntime } from "./adapter.mjs";
import { loadPiAi } from "./imports.mjs";

// The ATTACH POSTURE travels through this seam (D339) so an attached pane is BOOTABLE by a
// test or a host without reaching into createDurableTuiRuntime by hand: `spoolDb` is the
// broker's inbox spool, `clientName` names this pane in the merged stream, `rereadMs` is the
// viewer's re-read clock (0 = no timer), `attachWaitMs` bounds one routed act's round trip.
export async function bootDurableTui({ responses = [], fauxOptions = {}, cwd, storage, settings, readOnly, spoolDb = null, clientName = null, rereadMs = 0, attachWaitMs = 20_000 } = {}) {
	const ai = await loadPiAi();
	const faux = ai.fauxProvider(fauxOptions);
	if (responses.length > 0) faux.setResponses(responses);
	const models = ai.createModels();
	models.setProvider(faux.provider);
	const workDir = cwd ?? mkdtempSync(join(tmpdir(), "durable-tui-cwd-"));
	const agentDir = mkdtempSync(join(tmpdir(), "durable-tui-agent-"));
	const result = await createDurableTuiRuntime({
		cwd: workDir,
		agentDir,
		models,
		agentModel: { provider: "faux", modelId: "faux-1" },
		...(storage === undefined ? {} : { storage }),
		...(settings === undefined ? {} : { settings }),
		...(readOnly === undefined || readOnly === false ? {} : { readOnly: true }),
		spoolDb,
		clientName,
		rereadMs,
		attachWaitMs,
	});
	return { ...result, faux, models, cwd: workDir, agentDir };
}

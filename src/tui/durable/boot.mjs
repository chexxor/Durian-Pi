// Compose a durable-backed runtime for a smoke run or a test: a faux model on
// the durable side (so no network), and a temp cwd/agentDir for the host shell.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDurableTuiRuntime } from "./adapter.mjs";
import { loadPiAi } from "./imports.mjs";

export async function bootDurableTui({ responses = [], fauxOptions = {}, cwd, storage, settings } = {}) {
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
	});
	return { ...result, faux, models, cwd: workDir, agentDir };
}

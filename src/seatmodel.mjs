// Seat model string resolution: "{provider}/{modelId}" or bare "{modelId}".
//
// Disambiguation rule: durig model ids themselves contain slashes
// (zai-org/GLM-5.3-Flash), so a leading segment counts as the provider ONLY
// when it names a provider actually registered in the Models registry —
// otherwise the whole string is a model id under the rig's default provider.

/**
 * @param {{getProvider(id: string): object|undefined}} models
 * @param {string|undefined} seatModel raw seat.model from the rig spec
 * @param {string} defaultProvider rig-level provider id
 * @param {string} defaultModelId rig-level default model id
 * @returns {{provider: string, modelId: string}}
 */
export function resolveSeatModel(models, seatModel, defaultProvider, defaultModelId) {
	if (!seatModel) return { provider: defaultProvider, modelId: defaultModelId };
	const idx = seatModel.indexOf("/");
	if (idx > 0 && models.getProvider(seatModel.slice(0, idx))) {
		return { provider: seatModel.slice(0, idx), modelId: seatModel.slice(idx + 1) };
	}
	return { provider: defaultProvider, modelId: seatModel };
}

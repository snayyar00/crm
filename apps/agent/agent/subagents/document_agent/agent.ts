import { defineAgent, defineDynamic } from "eve";
import { selectedModel } from "../../lib/model";

export default defineAgent({
	description:
		"Generate branded Statements of Work (SOWs) from CRM deal data. Produces an accessible tagged PDF with the WebAbility brand. Use when a deal enters CONTRACT_SENT or when Sid asks for a SOW draft.",
	model: defineDynamic({
		events: { "session.started": () => selectedModel() },
	}),
	limits: {
		maxInputTokensPerSession: 100_000,
		maxOutputTokensPerSession: 20_000,
		sessionTimeoutMs: 10 * 60 * 1000,
	},
});

import { defineAgent, defineDynamic } from "eve";
import { selectedModel } from "../../lib/model";
import { morphStepHandler } from "../../lib/morph";

export default defineAgent({
	description:
		"Turn one private CRM builder-chat request into a validated, reviewable team-agent version without deploying it.",
	model: defineDynamic({
		events: {
			"session.started": () => selectedModel(),
			"step.started": morphStepHandler(() => selectedModel()),
		},
	}),
	limits: {
		maxInputTokensPerSession: 100_000,
		maxOutputTokensPerSession: 10_000,
		sessionTimeoutMs: 24 * 60 * 60 * 1000,
	},
});

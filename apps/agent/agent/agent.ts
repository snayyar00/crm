import "@crm/env/load";

import { DEFAULT_AGENT_MODEL } from "@crm/db/settings";
import { onTelemetryProblem, syncVersion } from "@crm/telemetry";
import { defineAgent, defineDynamic } from "eve";
import { logCapabilities } from "./lib/capabilities";
import { selectedModel } from "./lib/model";

void logCapabilities();

onTelemetryProblem((message) => console.debug(`[telemetry] ${message}`));

void syncVersion();

export default defineAgent({
	model: defineDynamic({
		fallback: DEFAULT_AGENT_MODEL.id,
		events: { "session.started": () => selectedModel() },
	}),
	limits: {
		// Delegated runner sessions draw from this root budget, so it must be
		// at least the runner's own cap (see subagents/agent_runner/agent.ts).
		maxInputTokensPerSession: 1_500_000,
		maxOutputTokensPerSession: 150_000,
		sessionTimeoutMs: 30 * 24 * 60 * 60 * 1000,
	},
});

import { DEFAULT_AGENT_MODEL } from "@crm/db/settings";
import { defineAgent, defineDynamic } from "eve";
import { z } from "zod";

export default defineAgent({
	description:
		"Generate branded Statements of Work (SOWs) from CRM deal data. Produces an accessible tagged PDF with the WebAbility brand. Use when a deal enters CONTRACT_SENT or when Sid asks for a SOW draft.",
	model: defineDynamic({
		fallback: DEFAULT_AGENT_MODEL.id,
	}),
	outputSchema: z.object({
		pdf_path: z.string().describe("Absolute path to the generated PDF in the sandbox workspace"),
		sow_ref: z.string().describe("The SOW reference number, e.g. SOW-2026-XXXX"),
		client_name: z.string(),
		fee: z.number(),
	}),
	limits: {
		maxInputTokensPerSession: 100_000,
		maxOutputTokensPerSession: 20_000,
		sessionTimeoutMs: 10 * 60 * 1000,
	},
});

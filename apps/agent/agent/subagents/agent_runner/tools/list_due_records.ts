import { defineTool } from "eve/tools";
import { z } from "zod";
import { listRunDueRecords } from "../../../lib/run-runtime";
import { requireTeamAgentAttribute } from "../../../lib/session-purpose";

export default defineTool({
	description:
		"List the approved records this run should work on: new to this agent, changed since the agent last reviewed them (edit, activity, or new email), or with a follow-up due. Everything else was reviewed already and is skipped. Call this before any query_crm.",
	inputSchema: z.object({
		kinds: z.array(z.enum(["contact", "company", "deal"])).optional(),
		limit: z.number().int().min(1).max(50).default(25),
	}),
	async execute(input, ctx) {
		return listRunDueRecords(requireTeamAgentAttribute(ctx, "runId"), input);
	},
});

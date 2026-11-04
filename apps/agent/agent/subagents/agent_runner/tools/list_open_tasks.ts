import { defineTool } from "eve/tools";
import { z } from "zod";
import { DISPATCH } from "../../../lib/dispatch-config";
import { listRunOpenTasks } from "../../../lib/run-runtime";
import { requireTeamAgentAttribute } from "../../../lib/session-purpose";

const { defaultLimit, maxLimit } = DISPATCH.run.openTasks;

export default defineTool({
	description:
		"List open CRM tasks across this version's approved scope, soonest due first, with due date, owner, and linked contact, company, and deal. Covers tasks on any record, including records with no open deal. `total` counts every match, so compare it to the rows returned. Does not mark any record reviewed.",
	inputSchema: z.object({
		overdueOnly: z.boolean().default(false),
		limit: z.number().int().min(1).max(maxLimit).default(defaultLimit),
	}),
	async execute(input, ctx) {
		return listRunOpenTasks(requireTeamAgentAttribute(ctx, "runId"), input);
	},
});

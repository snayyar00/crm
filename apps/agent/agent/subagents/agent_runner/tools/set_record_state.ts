import { defineTool } from "eve/tools";
import { z } from "zod";
import { setRunRecordState } from "../../../lib/run-runtime";
import { requireTeamAgentAttribute } from "../../../lib/session-purpose";

export default defineTool({
	description:
		"Record where this agent stands with one record so later runs skip it until it changes or its next step is due. ACTIVE needs nextDueAt (the next step's date). PARKED and BLOCKED take a reason and an optional nextDueAt to look again. DONE means the playbook is complete. Use this instead of housekeeping notes such as 'Needs segment' or 'Parked'.",
	inputSchema: z.object({
		kind: z.enum(["contact", "company", "deal"]),
		id: z.string().min(1),
		status: z.enum(["ACTIVE", "PARKED", "BLOCKED", "DONE"]),
		reason: z.string().trim().max(500).nullish(),
		nextDueAt: z.string().nullish(),
	}),
	async execute(input, ctx) {
		return setRunRecordState(requireTeamAgentAttribute(ctx, "runId"), input);
	},
});

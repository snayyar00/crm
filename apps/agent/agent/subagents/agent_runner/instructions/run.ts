import { defineDynamic, defineInstructions } from "eve/instructions";
import type { DueRecord } from "../../../lib/record-state";
import {
	approvedRunInstructions,
	listRunDueRecords,
} from "../../../lib/run-runtime";
import { attribute, purposeOf } from "../../../lib/session-purpose";

export default defineDynamic({
	events: {
		"session.started": async (_event, ctx) => {
			if (purposeOf(ctx) !== "team-agent") return null;
			const runId = attribute(ctx, "runId");
			if (!runId) return null;

			const [instructions, due] = await Promise.all([
				approvedRunInstructions(runId),
				listRunDueRecords(runId),
			]);
			return defineInstructions({
				markdown: `# Human-approved version instructions\n\n${instructions}\n\n# Records in scope for this run\n\n${renderDue(due)}`,
			});
		},
	},
});

export function renderDue(due: {
	now: string;
	inScope: number;
	due: DueRecord[];
	dueTotal: number;
	skipped: number;
}): string {
	if (due.due.length === 0) {
		return `Nothing is due as of ${due.now}: all ${due.inScope} approved records were reviewed already and have not changed. Call \`finish_run\` now with no changes.`;
	}
	const lines = due.due.map((row) => {
		const state = row.state
			? ` · state ${row.state.status}${row.state.reason ? ` (${row.state.reason})` : ""}${row.state.nextDueAt ? ` · next due ${row.state.nextDueAt.slice(0, 10)}` : ""}`
			: "";
		return `- ${row.kind} ${row.label} (\`${row.id}\`) — ${row.dueBecause}${state}`;
	});
	const more =
		due.dueTotal > due.due.length
			? `\n\n${due.dueTotal - due.due.length} more are due; call \`list_due_records\` again after these.`
			: "";
	return `As of ${due.now}, ${due.dueTotal} of ${due.inScope} approved records need attention; ${due.skipped} were reviewed already and are unchanged. Work only on these:\n\n${lines.join("\n")}${more}`;
}

"use client";

import { Button } from "@crm/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { recordHref } from "@/lib/record-href";
import { useTRPC } from "@/lib/trpc/client";

/** Far enough out to include a 6-month re-check's approach without listing it
 *  from the day it is created. */
export const HORIZON_DAYS = 120;

type Group = {
	key: string;
	title: string;
	blurb: string;
	tone: string;
	match: (r: Row) => boolean;
};

type Row = {
	id: string;
	subject: string | null;
	dueAt: string | Date | null;
	kind?: string;
	daysUntilDue: number;
	leadDays: number;
	slack: number;
	irreversible: boolean;
	awaitingStart?: boolean;
	deal?: { name: string; stage: string } | null;
	company?: { name: string } | null;
	dealId?: string | null;
	companyId?: string | null;
};

/**
 * Three groups, in the order a founder should read them.
 *
 * "Act now" is not "due now" — it is slack <= 0, i.e. the point where the work
 * needed to meet the date should already have started. A trial 11 days out with
 * a 14-day runway belongs here; a deliverable 5 days out with a 3-day runway
 * does not. That is the same rule the morning alarm uses, imported from the API
 * rather than re-implemented, so the screen and the email can never disagree.
 */
const GROUPS: Group[] = [
	{
		// First, because it is the group that needs a nudge to THEM rather than work
		// from you — and because reading it as "overdue" blames you for their silence.
		key: "waiting",
		title: "Waiting on the customer",
		blurb:
			"Work cannot start until they send what was asked for. Dates are placeholders and re-derive once it arrives. Never emailed.",
		tone: "text-muted-foreground",
		match: (r) => Boolean(r.awaitingStart),
	},
	{
		key: "overdue",
		title: "Overdue",
		blurb: "The date has passed. Still open.",
		tone: "text-red-600 dark:text-red-400",
		match: (r) => !r.awaitingStart && r.daysUntilDue < 0,
	},
	{
		key: "act",
		title: "Act now",
		blurb: "Inside the runway this kind needs. The alarm emails these.",
		tone: "text-amber-600 dark:text-amber-400",
		match: (r) => !r.awaitingStart && r.daysUntilDue >= 0 && r.slack <= 0,
	},
	{
		key: "ahead",
		title: "Ahead of it",
		blurb: "Dated, not yet urgent. Deliberately not emailed.",
		tone: "text-muted-foreground",
		match: (r) => !r.awaitingStart && r.slack > 0,
	},
];

function when(r: Row): string {
	// Deliberately shows no day count: the number would be a placeholder derived
	// from the close date, and printing it invites someone to act on it.
	if (r.awaitingStart) return "not started";
	if (r.daysUntilDue < 0) return `${Math.abs(r.daysUntilDue)} days overdue`;
	if (r.daysUntilDue === 0) return "due today";
	return `${r.daysUntilDue} days left`;
}

/** Say why it is urgent, not just that it is. */
function runway(r: Row): string {
	if (r.awaitingStart) return "clock starts when they respond";
	if (r.slack > 0) return `needs ${r.leadDays}d — ${r.slack}d of slack`;
	if (r.slack === 0) return `needs ${r.leadDays}d — start today`;
	return `needs ${r.leadDays}d — ${Math.abs(r.slack)}d past the start point`;
}

export function CalendarList() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { slug } = useParams<{ slug: string }>();
	const { data, isPending } = useQuery(
		trpc.obligations.due.queryOptions({ withinDays: HORIZON_DAYS }),
	);

	// Completing here is the point of the screen, not a convenience: a clock you
	// cannot clear nags forever, and a nag that cannot be cleared is what teaches
	// someone to ignore the alarm. Closing a re-check also spawns the next one,
	// so this is how the recurring cycle actually turns.
	const complete = useMutation(
		trpc.activities.complete.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: trpc.obligations.due.queryKey({ withinDays: HORIZON_DAYS }),
				});
				toast.success("Marked done.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	/** Where this obligation actually lives, so the row can be opened. */
	const hrefFor = (r: Row): string | null => {
		if (r.dealId) return recordHref(slug, "/deals", "deal", r.dealId);
		if (r.companyId)
			return recordHref(slug, "/companies", "company", r.companyId);
		return null;
	};

	if (isPending)
		return <p className="text-muted-foreground text-sm">Loading…</p>;

	const rows = (data ?? []) as unknown as Row[];
	if (rows.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No contractual clocks in the next {HORIZON_DAYS} days. Obligations
				appear here when a deal is won or a trial is recorded.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-8">
			{GROUPS.map((g) => {
				const items = rows.filter(g.match);
				if (items.length === 0) return null;
				return (
					<section key={g.key} className="flex flex-col gap-2">
						<div>
							<h2 className={`font-medium text-sm ${g.tone}`}>
								{g.title} ({items.length})
							</h2>
							<p className="text-muted-foreground text-xs">{g.blurb}</p>
						</div>
						<ul className="divide-y rounded-md border">
							{items.map((r) => {
								const href = hrefFor(r);
								const body = (
									<>
										<div className="min-w-0">
											<p className="truncate font-medium text-sm">
												{r.deal?.name ?? r.company?.name ?? "—"}
												{r.irreversible ? (
													// A lapse cannot be undone by doing the work late,
													// which is the whole reason it outranks overdue work.
													<span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 font-normal text-red-700 text-xs dark:bg-red-950 dark:text-red-300">
														lapses
													</span>
												) : null}
											</p>
											<p className="truncate text-muted-foreground text-xs">
												{r.subject}
											</p>
										</div>
										<div className="shrink-0 text-right">
											<p className={`text-sm ${g.tone}`}>{when(r)}</p>
											<p className="text-muted-foreground text-xs">
												{runway(r)}
											</p>
										</div>
									</>
								);

								return (
									<li key={r.id} className="flex items-center gap-2 px-3 py-2">
										{href ? (
											<Link
												href={href}
												className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-sm hover:opacity-80"
											>
												{body}
											</Link>
										) : (
											<div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
												{body}
											</div>
										)}
										<Button
											size="sm"
											variant="outline"
											className="shrink-0"
											disabled={complete.isPending}
											onClick={() =>
												complete.mutate({ id: r.id, completed: true })
											}
										>
											Done
										</Button>
									</li>
								);
							})}
						</ul>
					</section>
				);
			})}
		</div>
	);
}

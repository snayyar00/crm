import type { Metadata } from "next";
import { Suspense } from "react";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellLoading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { CalendarList, HORIZON_DAYS } from "./calendar-list";

export const metadata: Metadata = {
	title: "Calendar",
};

/**
 * The compliance calendar.
 *
 * The alarm emails at most three obligations and only once they are inside their
 * lead window. That is deliberate — a mail that arrives every morning stops being
 * read. But it means everything else is invisible, and an accessibility buyer's
 * clock is legal rather than emotional: re-check dates, VPAT versions and trial
 * windows all land whether or not anyone is thinking about them. This is the one
 * screen that shows the whole board.
 */
export default function CalendarPage() {
	return (
		<PageShell className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Calendar</PageShellTitle>
					<PageShellDescription>
						Every contractual clock, and how much runway is left on each.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent className="min-h-0">
				<Suspense fallback={<PageShellLoading />}>
					<Calendar />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function Calendar() {
	await requireSession();
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await queryClient.prefetchQuery(
		trpc.obligations.due.queryOptions({ withinDays: HORIZON_DAYS }),
	);
	return (
		<HydrateClient>
			<CalendarList />
		</HydrateClient>
	);
}

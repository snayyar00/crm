import { Badge } from "@crm/ui/components/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@crm/ui/components/table";
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
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import type { RouterOutputs } from "@/lib/trpc/types";

export const metadata: Metadata = {
	title: "Crons & Syncs",
};

type CronsData = RouterOutputs["ops"]["crons"];
type Health = CronsData["syncs"][number]["health"];

const HEALTH_VARIANT = {
	ok: "default",
	late: "destructive",
	error: "destructive",
	unknown: "outline",
} as const satisfies Record<Health, string>;

const HEALTH_LABEL: Record<Health, string> = {
	ok: "Healthy",
	late: "Late",
	error: "Error",
	unknown: "No signal",
};

function HealthBadge({ health }: { health: Health }) {
	return <Badge variant={HEALTH_VARIANT[health]}>{HEALTH_LABEL[health]}</Badge>;
}

function when(d: Date | string | null): string {
	if (!d) return "never";
	const t = typeof d === "string" ? new Date(d) : d;
	const min = Math.round((Date.now() - t.getTime()) / 60_000);
	if (min < 1) return "just now";
	if (min < 60) return `${min} min ago`;
	if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
	return `${Math.round(min / 1440)} d ago`;
}

export default function CronsSettingsPage() {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Crons &amp; Syncs</PageShellTitle>
					<PageShellDescription>
						Every scheduled thing this CRM depends on, what it does, and whether
						it is actually running.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>

			<PageShellContent>
				<Suspense fallback={<PageShellLoading />}>
					<Crons />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function Crons() {
	await requireSession();

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	const data: CronsData = await queryClient.fetchQuery(
		trpc.ops.crons.queryOptions(),
	);

	return (
		<div className="flex flex-col gap-8">
			<section className="flex flex-col gap-2">
				<h2 className="font-medium text-sm">Mailbox &amp; calendar syncs</h2>
				<p className="text-muted-foreground text-sm">
					Google sync workers inside this app. They pull mail and calendar into
					the activity feed; a reply lands here within minutes of arriving.
				</p>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Mailbox</TableHead>
							<TableHead>Source</TableHead>
							<TableHead>Last synced</TableHead>
							<TableHead>Health</TableHead>
							<TableHead>Last error</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.syncs.map((s) => (
							<TableRow key={s.id}>
								<TableCell>{s.mailbox}</TableCell>
								<TableCell>{s.source}</TableCell>
								<TableCell>{when(s.lastSyncedAt)}</TableCell>
								<TableCell>
									<HealthBadge health={s.health} />
								</TableCell>
								<TableCell className="max-w-96 truncate text-muted-foreground">
									{s.lastError ?? "—"}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</section>

			<section className="flex flex-col gap-2">
				<h2 className="font-medium text-sm">Agent schedules</h2>
				<p className="text-muted-foreground text-sm">
					In-app agents on a timer. They draft and queue; a human approves every
					send.
				</p>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Agent</TableHead>
							<TableHead>Schedule</TableHead>
							<TableHead>Last run</TableHead>
							<TableHead>Next run</TableHead>
							<TableHead>Health</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.agentTriggers.map((t) => (
							<TableRow key={t.id}>
								<TableCell>{t.agent}</TableCell>
								<TableCell>
									{t.enabled ? `every ${t.intervalMinutes} min` : "disabled"}
								</TableCell>
								<TableCell>{when(t.lastRunAt)}</TableCell>
								<TableCell>{when(t.nextRunAt)}</TableCell>
								<TableCell>
									<HealthBadge health={t.health} />
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</section>

			<section className="flex flex-col gap-2">
				<h2 className="font-medium text-sm">External crons</h2>
				<p className="text-muted-foreground text-sm">
					Schedulers outside this app (host and Mac crontabs). Each run stamps a
					heartbeat here; "No signal" means the script has never confirmed a
					run, not that it is healthy.
				</p>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Cron</TableHead>
							<TableHead>Where</TableHead>
							<TableHead>What it does</TableHead>
							<TableHead>Last heartbeat</TableHead>
							<TableHead>Runs</TableHead>
							<TableHead>Health</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.external.map((c) => (
							<TableRow key={c.id}>
								<TableCell>{c.name}</TableCell>
								<TableCell className="whitespace-normal text-muted-foreground">
									{c.where}
								</TableCell>
								<TableCell className="max-w-96 whitespace-normal text-muted-foreground">
									{c.purpose}
								</TableCell>
								<TableCell>{when(c.lastBeatAt)}</TableCell>
								<TableCell>{c.totalRuns}</TableCell>
								<TableCell>
									<HealthBadge health={c.health} />
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</section>
		</div>
	);
}

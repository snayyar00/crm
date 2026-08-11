"use client";

import { Button } from "@crm/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@crm/ui/components/dialog";
import { useState } from "react";

export type EngagementType = "AUDIT" | "SUBSCRIPTION" | "OTHER";

/**
 * Asked once, at the moment a deal is won.
 *
 * Winning an AUDIT creates five contractual deliverables and a 6-month re-check;
 * winning a subscription creates none. Nothing in the schema distinguishes them
 * — on the real book three of the four won deals are not audits, and `amount`
 * cannot tell (the audit is CHEAPER than two of the subscriptions). So the CRM
 * asks rather than guesses, the same way it already refuses to close a deal as
 * lost without a reason.
 *
 * It rides the click the founder is already making. A separate optional control
 * on the deal record would be the kind of thing nobody remembers to set.
 */
const OPTIONS: Array<{ value: EngagementType; label: string; blurb: string }> =
	[
		{
			value: "AUDIT",
			label: "Audit engagement",
			blurb:
				"A signed WCAG audit. Creates the report, VPAT, accessibility statement, remediation verification and the 6-month re-check, each dated.",
		},
		{
			value: "SUBSCRIPTION",
			label: "Subscription",
			blurb: "Widget or agency plan. No contractual deliverables are created.",
		},
		{
			value: "OTHER",
			label: "Something else",
			blurb: "Recorded as won, with no deliverables.",
		},
	];

export function EngagementTypeDialog({
	open,
	count = 1,
	pending,
	onCancel,
	onConfirm,
}: {
	open: boolean;
	count?: number;
	pending: boolean;
	onCancel: () => void;
	onConfirm: (type: EngagementType) => void;
}) {
	const [choice, setChoice] = useState<EngagementType | null>(null);

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (next) return;
				setChoice(null);
				onCancel();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{count > 1 ? `Close ${count} deals as won` : "Close as won"}
					</DialogTitle>
					<DialogDescription>
						What kind of engagement {count > 1 ? "were these" : "was this"}? It
						decides which contractual clocks start today.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-2 px-4">
					{OPTIONS.map((o) => (
						<button
							key={o.value}
							type="button"
							aria-pressed={choice === o.value}
							onClick={() => setChoice(o.value)}
							className={`rounded-md border p-3 text-left transition-colors ${
								choice === o.value
									? "border-foreground bg-accent"
									: "hover:bg-accent/50"
							}`}
						>
							<span className="block font-medium text-sm">{o.label}</span>
							<span className="block text-muted-foreground text-xs">
								{o.blurb}
							</span>
						</button>
					))}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onCancel} disabled={pending}>
						Cancel
					</Button>
					<Button
						onClick={() => choice && onConfirm(choice)}
						disabled={!choice || pending}
					>
						Close as won
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

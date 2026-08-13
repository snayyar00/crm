import { db } from "@crm/db";
import { defineTool } from "eve/tools";
import { z } from "zod";

type Deliverable = { name: string; desc: string };

function auditDeliverables(client: string, recheckMonths: number): Deliverable[] {
	return [
		{
			name: "Detailed audit report",
			desc: "Severity-ranked findings with WCAG references, screenshot evidence, engineering recommendations, and integrated Dev Status / QA Status remediation-tracking columns. Presented in a live findings-walkthrough session with your engineering team.",
		},
		{
			name: "Remediation support & validation",
			desc: "Standing engineering support channel throughout remediation; WebAbility retests and validates every fix in the shared tracker. Includes fix-level guidance for all identified issues within the agreed scope.",
		},
		{
			name: "VPAT 2.5 / ACR",
			desc: "Accessibility Conformance Report issued after validation, authored per WCAG 2.2 with per-criterion verdicts. The VPAT/ACR will reflect the product's validated conformance status at the time of issuance. No specific conformance outcome is guaranteed or predetermined.",
		},
		{
			name: "Accessibility statement",
			desc: "Publishable statement for the audited product surface.",
		},
		{
			name: "Developer enablement",
			desc: `12 months of access to the WebAbility CLI and MCP integration, embedding accessibility verification into ${client}'s development workflow and CI, plus a live training session (60–90 min) covering CLI and MCP setup, common WCAG 2.2 patterns, and how to read the audit deliverables.`,
		},
		{
			name: "Ongoing partnership",
			desc: "A shared Slack or Teams channel with a named point of contact for the first year, plus quarterly check-in calls (4 × 30 min).",
		},
		{
			name: `${recheckMonths}-month re-check`,
			desc: `Re-audit of the scoped pages approximately ${recheckMonths} months after ACR issuance, with a refreshed accessibility statement and delta report.`,
		},
	];
}

function subscriptionDeliverables(): Deliverable[] {
	return [
		{
			name: "Widget installation",
			desc: "WebAbility accessibility widget installation and configuration on the licensed domain(s).",
		},
		{
			name: "Auto-fix engine",
			desc: "AI-powered auto-fix engine with a per-change approval queue — no silent modifications to your site.",
		},
		{
			name: "Compliance surface",
			desc: "Accessibility statement and compliance badge for the licensed property.",
		},
		{
			name: "Monitoring",
			desc: "Monthly automated scans with severity tracking and dashboard access for monitoring and reporting.",
		},
		{
			name: "Support",
			desc: "Email and chat support during business hours, plus quarterly compliance check-ins.",
		},
	];
}

function parseNoteHints(
	notes: { subject: string | null; body: string | null }[],
): {
	deliverables?: string[];
	discount?: { percent: number; deadline: string };
	scopePages?: string;
	scopeTarget?: string;
	background?: string;
	remediationMonths?: number;
	feeNote?: string;
	specialTerms?: string;
} {
	const full = notes
		.map((n) => `${n.subject ?? ""} ${n.body ?? ""}`)
		.join("\n");

	const hints: Record<string, unknown> = {};

	const dlMatch = full.match(/deliverables?\s*[:\-]\s*(.+?)(?:\n|$)/i);
	if (dlMatch?.[1]) {
		hints.deliverables = dlMatch[1]
			.split(/[,;]/)
			.map((s) => s.trim())
			.filter(Boolean);
	}

	const discMatch = full.match(
		/discount\s+(\d+)%?\s*(?:by|before|if signed by)\s+(.+?)(?:\n|$)/i,
	);
	if (discMatch?.[1] && discMatch[2]) {
		hints.discount = {
			percent: Number.parseInt(discMatch[1], 10),
			deadline: discMatch[2].trim(),
		};
	}

	const pagesMatch = full.match(/scope\s+pages?\s*[:\-]\s*(.+?)(?:\n|$)/i);
	if (pagesMatch?.[1]) hints.scopePages = pagesMatch[1].trim();

	const targetMatch = full.match(/scope\s+target\s*[:\-]\s*(.+?)(?:\n|$)/i);
	if (targetMatch?.[1]) hints.scopeTarget = targetMatch[1].trim();

	const bgMatch = full.match(/sow\s+background\s*[:\-]\s*(.+?)(?:\n|$)/i);
	if (bgMatch?.[1]) hints.background = bgMatch[1].trim();

	// e.g. "remediation window: 8 months" — stretches the remediation phase.
	const remMatch = full.match(
		/remediation\s+window\s*[:\-]\s*(\d+)\s*months?/i,
	);
	if (remMatch?.[1]) hints.remediationMonths = Number.parseInt(remMatch[1], 10);

	// e.g. "fee note: Phase 2 (+$4,000) and Phase 3 (+$2,000) available..."
	const feeNoteMatch = full.match(/fee\s+note\s*[:\-]\s*(.+?)(?:\n|$)/i);
	if (feeNoteMatch?.[1]) hints.feeNote = feeNoteMatch[1].trim();

	const termsMatch = full.match(/special\s+terms?\s*[:\-]\s*(.+?)(?:\n|$)/i);
	if (termsMatch?.[1]) hints.specialTerms = termsMatch[1].trim();

	return hints as ReturnType<typeof parseNoteHints>;
}

function generateSowRef(): string {
	const year = new Date().getFullYear();
	const nnnn = String(Math.floor(1000 + Math.random() * 9000));
	return `SOW-${year}-${nnnn}`;
}

function formatDate(d: Date): string {
	return d.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

export default defineTool({
	description:
		"Generate a branded Statement of Work PDF from a CRM deal, matching the signed Questback SOW design (navy cover, 14 numbered sections, deliverables/timeline tables, fee banner, execution block with DocuSign anchors). Reads the deal, its engagementType, company, contacts, and recent NOTES for hints (scope pages/target, discount, 'remediation window: N months', 'fee note: ...', 'sow background: ...'). Returns the PDF path in the sandbox.",
	inputSchema: z.object({
		dealId: z
			.string()
			.min(1)
			.describe("The CRM deal id to generate a SOW for"),
	}),
	async execute(input, ctx) {
		const deal = await db.deal.findUnique({
			where: { id: input.dealId },
			select: {
				name: true,
				amount: true,
				currency: true,
				stage: true,
				engagementType: true,
				closedAt: true,
				expectedCloseDate: true,
				company: {
					select: {
						name: true,
						domain: true,
					},
				},
				contacts: {
					select: {
						role: true,
						contact: {
							select: {
								firstName: true,
								lastName: true,
								title: true,
								email: true,
							},
						},
					},
				},
				activities: {
					where: { type: "NOTE" },
					select: { subject: true, body: true },
					orderBy: { createdAt: "desc" },
					take: 10,
				},
			},
		});

		if (!deal) {
			return { error: `Deal ${input.dealId} not found` };
		}

		const clientName = deal.company.name;
		const isAudit = deal.engagementType !== "SUBSCRIPTION";
		const standard = isAudit ? "WCAG 2.2 AA" : "WCAG 2.1 AA";

		const signerContact = deal.contacts.find(
			(dc) => dc.role === "signer" || dc.role === "decision_maker",
		)?.contact;
		const primary = signerContact ?? deal.contacts[0]?.contact;
		const contactName = primary
			? [primary.firstName, primary.lastName].filter(Boolean).join(" ") ||
				"Primary Contact"
			: "Primary Contact";
		const contactTitle = primary?.title ?? "";
		const contactEmail = primary?.email ?? "";

		const hints = parseNoteHints(deal.activities);
		const recheckMonths = 8;
		const remMonths = hints.remediationMonths;
		const scopeTarget = hints.scopeTarget ?? `the ${clientName} web property`;
		const scopePages = hints.scopePages ?? "Up to 15 pages/steps";

		const sowRef = generateSowRef();
		const today = new Date();
		const monthYear = today.toLocaleDateString("en-US", {
			month: "long",
			year: "numeric",
		});

		const discountBanner =
			hints.discount && deal.amount
				? `Includes a ${hints.discount.percent}% discount from the standard fee of $${(
						Number(deal.amount) /
						(1 - hints.discount.percent / 100)
					).toFixed(0)}, valid if this SOW is signed on or before <strong>${hints.discount.deadline}</strong>. After that date the standard fee applies.`
				: undefined;

		const remediationSummary = remMonths
			? `The audit phase runs two to three weeks from kickoff. This SOW provides a remediation window of up to ${remMonths} months from delivery of the audit report; WebAbility validates fixes throughout that window, and the VPAT/ACR is issued after final validation.`
			: "The engagement runs five to six weeks from kickoff.";

		const executiveSummary = isAudit
			? [
					`WebAbility will conduct an independent ${standard} conformance engagement covering ${scopeTarget}, scoped to ${scopePages.toLowerCase()}. The engagement follows the W3C's formal evaluation methodology (WCAG-EM) and concludes with conformance documentation suitable for customer procurement and regulatory contexts.`,
					`${remediationSummary} We retest every fix before the conformance documentation is issued, and the VPAT is authored to reflect the product's actual conformance level (a Partially Conformant report is the expected and honest outcome for a live application). A re-check of the scoped pages is included ${recheckMonths} months after ACR issuance.`,
				]
			: [
					`WebAbility will license, install, and operate its accessibility widget and monitoring platform for ${scopeTarget}, targeting ${standard}, with monthly automated scans, a human-reviewed auto-fix queue, and publishable compliance documentation.`,
				];

		const timelineWeeks = isAudit
			? [
					{
						label: "Week 1",
						desc: "Kickoff; scope inventory frozen; environment access confirmed; automated pass",
					},
					{
						label: "Weeks 1–2",
						desc: "Manual expert audit: keyboard, screen readers, zoom, contrast, form states",
					},
					{
						label: "Week 3",
						desc: `Audit report delivered; findings walkthrough with ${clientName} engineering${remMonths ? "; remediation window opens" : ""}`,
					},
					remMonths
						? {
								label: `Months 1–${remMonths}`,
								desc: `Remediation by ${clientName} engineers at their own pace, with WebAbility support and validation retesting as fixes land (up to ${remMonths} months from report delivery)`,
							}
						: {
								label: "Weeks 3–5",
								desc: `Remediation by ${clientName} engineers with WebAbility support; validation retesting`,
							},
					{
						label: remMonths ? "On completion" : "Weeks 5–6",
						desc: "Final validation; VPAT/ACR and accessibility statement issued",
					},
					{
						label: `+${recheckMonths} months`,
						desc: `Re-check audit and report delta (${recheckMonths} months after ACR issuance)`,
					},
				]
			: [
					{
						label: "Day 1–2",
						desc: "Widget installed and configured on the licensed domain(s)",
					},
					{
						label: "Week 1",
						desc: "Baseline scan; auto-fix queue reviewed and approved",
					},
					{ label: "Monthly", desc: "Automated scans with severity tracking" },
					{ label: "Quarterly", desc: "Compliance check-in call" },
				];

		const deliverables: Deliverable[] | string[] =
			hints.deliverables ??
			(isAudit ? auditDeliverables(clientName, recheckMonths) : subscriptionDeliverables());

		const config = {
			sow_ref: sowRef,
			date: formatDate(today),
			month_year: monthYear,
			signer_deadline: hints.discount?.deadline,
			engagement_title: isAudit
				? `${standard} Conformance Engagement`
				: "Accessibility Subscription Engagement",
			cover_subtitle: isAudit
				? `Accessibility Audit · Remediation Support · Partially Conformant VPAT/ACR · ${recheckMonths}-Month Re-check`
				: "Accessibility Widget · Monitoring · Compliance Documentation",
			client: {
				company_name: clientName,
				domain: deal.company.domain ?? "",
				contact_name: contactName,
				contact_title: contactTitle,
				contact_email: contactEmail,
			},
			executive_summary: executiveSummary,
			background_paras: [
				hints.background ??
					`${clientName} has requested ${
						isAudit
							? `an independent accessibility audit of ${scopeTarget} to assess conformance with the Web Content Accessibility Guidelines (WCAG) 2.2 Levels A and AA, identify barriers, support remediation, and produce conformance documentation (VPAT/ACR and accessibility statement) suitable for customer procurement and regulatory contexts.`
							: `WebAbility's accessibility subscription for ${scopeTarget}, covering widget-based remediation, monitoring, and compliance documentation.`
					}`,
			],
			scope: {
				standard,
				pages: scopePages,
				target: scopeTarget,
			},
			scope_details: isAudit
				? [
						"Core navigation and page structure across the scoped page set",
						"Keyboard operability: focus order, visible focus indicators, skip links",
						"Screen reader compatibility: landmarks, headings, labels, live regions",
						"Color contrast and text resizing (up to 200%)",
						"Form states: required-field validation, error messaging, progress indication, disabled/enabled controls",
						"Submission and confirmation screens, plus error and recovery states",
					]
				: [
						"Widget deployment on the licensed domain(s)",
						"Automated monthly scans of the licensed property",
						"Human-reviewed auto-fix queue",
					],
			out_of_scope: [
				`${clientName} native mobile applications (iOS/Android)`,
				"Emails, exported documents (PDF/Excel), and third-party embedded content",
				`Implementation of code changes in ${clientName}'s codebase. Remediation is implemented by ${clientName}'s engineers with WebAbility's guidance and fix-level validation (§06)`,
				"Legal advice or representation",
			],
			deliverables,
			timeline: { kickoff: "the week following signature" },
			timeline_weeks: timelineWeeks,
			recheck_months: recheckMonths,
			client_responsibilities: [
				"Provide a stable test environment/link for the scoped pages, frozen for the duration of the audit window",
				"Name a technical point of contact for remediation coordination and fix delivery",
				remMonths
					? `Complete remediation within the ${remMonths}-month remediation window so final validation and the ACR can be issued; unremediated findings at window close are documented as-is in the ACR`
					: "Apply remediation within the project window so validation and the ACR complete on schedule",
				"Return the completed engagement intake questionnaire ahead of kickoff",
			],
			fee: {
				amount: Number(deal.amount ?? 0),
				currency: deal.currency ?? "USD",
				payment_terms: "Net 15",
				label: isAudit ? "All-Inclusive Engagement Fee" : "Annual Subscription Fee",
				banner_note: hints.feeNote ?? discountBanner,
			},
			fee_terms: [
				"One-time fee, invoiced in full on execution of this SOW; terms Net 15",
				"Invoiced electronically; payment by card or bank transfer",
				`The fee covers every deliverable in §06${
					isAudit
						? `, including the${remMonths ? ` full ${remMonths}-month remediation window, the` : ""} ${recheckMonths}-month re-check and 12 months of CLI/MCP access`
						: ""
				}. No additional charges without prior written agreement.`,
				...(hints.specialTerms ? [hints.specialTerms] : []),
			],
			...(remMonths
				? {
						assumptions: [
							`Conformance outcomes depend on ${clientName} implementing the recommended remediation; the ACR reflects the state of the product as validated at issuance.`,
							`The remediation window runs up to ${remMonths} months from audit-report delivery. If remediation is not completed within it, WebAbility issues the VPAT/ACR based on the product's state at window close; further validation afterwards is handled by written change order.`,
							"WCAG conformance assessment involves expert judgment; WebAbility warrants a diligent, methodology-driven evaluation, not immunity from third-party claims.",
							"Material scope additions (new pages, flows, or products) are handled by written change order.",
						],
					}
				: {}),
		};

		const sandbox = await ctx.getSandbox();
		const configPath = sandbox.resolvePath("sow_config.json");
		await sandbox.writeTextFile({
			path: configPath,
			content: JSON.stringify(config, null, 2),
		});

		const outputPdf = sandbox.resolvePath(`${sowRef}.pdf`);

		const result = await sandbox.run({
			command: `python3 build_sow.py "${configPath}" "${outputPdf}"`,
		});

		if (result.exitCode !== 0) {
			return {
				error: "PDF generation failed",
				stderr: result.stderr,
				stdout: result.stdout,
			};
		}

		return {
			pdf_path: outputPdf,
			pdf_bytes: result.stdout.includes("PDF_SIZE:")
				? Number(
						result.stdout
							.split("\n")
							.find((l) => l.startsWith("PDF_SIZE:"))
							?.split(":")[1]
							?.trim() ?? "0",
					)
				: undefined,
			sow_ref: sowRef,
			client_name: clientName,
			fee: Number(deal.amount ?? 0),
			deal_name: deal.name,
			engagement_type: deal.engagementType,
			config,
		};
	},
});

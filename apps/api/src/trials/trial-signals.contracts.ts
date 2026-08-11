import { z } from "zod";

/**
 * What "engaged" means for an accessibility trial.
 *
 * NOT widget impressions. Impressions require the widget to be INSTALLED on a site
 * the evaluator owns, plus real visitor traffic. Verified against the live USPTO
 * trial: 4 of its 5 sites are angular.dev, drupal.org, dhs.gov and section508.gov —
 * third-party domains the evaluators cannot install anything on. Reading impressions
 * as engagement would score the most active possible evaluation team at zero.
 *
 * Evaluators SCAN sites they do not own. So the signals that mean something are
 * site-adds and scans, and the freshest of those is what the watchdog reads.
 */
export const trialSignalInput = z.object({
	/** Company whose trial we are assessing. */
	companyId: z.string(),
	/** Days before expiry at which a backstop alert is warranted. */
	backstopDays: z.number().int().min(1).max(30).default(3),
});

export const trialSignalOutput = z.object({
	seats: z.number(),
	sitesAdded: z.number(),
	/** Sites the account could plausibly install on (apex matches the account domain). */
	ownedSites: z.number(),
	/** Sites they are evaluating but do not own — the normal case for a 508 team. */
	thirdPartySites: z.number(),
	lastSiteAddedAt: z.string().nullable(),
	lastScanAt: z.string().nullable(),
	/** Days since ANY evaluator-side activity. */
	daysSinceActivity: z.number().nullable(),
	/** Days since we last emailed them. */
	daysSinceOurContact: z.number().nullable(),
	verdict: z.enum([
		"ACTIVE_AND_IGNORED",
		"ACTIVE",
		"GOING_QUIET",
		"NEVER_STARTED",
	]),
	reason: z.string(),
});

export type TrialSignalInput = z.infer<typeof trialSignalInput>;

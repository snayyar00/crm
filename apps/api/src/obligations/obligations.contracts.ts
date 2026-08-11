import { z } from "zod";

/**
 * Inputs for the obligation calendar.
 *
 * Deliberately small. There is NO generic `complete` here: an obligation does
 * not close the way an ordinary task does. TRIAL_EXPIRY lapses, RECHECK_DUE
 * regenerates, VPAT_EXPIRY supersedes — closing any of them needs a
 * kind-specific disposition (converted / lost / extended), and a raw
 * `complete(activityId)` would silently skip it. Until that disposition exists,
 * shipping no close is more honest than shipping the wrong one.
 */

export const obligationDueInput = z.object({
	withinDays: z.number().int().min(1).max(365).default(30),
});

/**
 * Trials are provisioned by hand in a different product's admin, so nothing in
 * this CRM can infer one, and coupling to the platform's MySQL schema to find
 * out is out of bounds. The founder — realistically an agent acting for him
 * over the crm-api skill — states it once and the clock becomes visible.
 *
 * `provisionedAt` + `lengthDays` rather than a bare expiry date: that pair is
 * what is actually known at provisioning time, and it keeps the generated body
 * ("14-day trial, 4 seat(s), provisioned X") true without a second field.
 */
export const obligationStartTrialInput = z.object({
	companyId: z.string().min(1),
	dealId: z.string().min(1).optional(),
	provisionedAt: z.coerce.date(),
	lengthDays: z.number().int().min(1).max(365),
	seats: z.number().int().min(1).max(10_000),
});

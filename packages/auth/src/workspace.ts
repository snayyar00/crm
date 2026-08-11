import "@crm/env/load";

type AllowList = {
	domains: readonly string[];
	addresses: readonly string[];
};

const EMPTY: AllowList = { domains: [], addresses: [] };

let cachedSource: string | undefined;
let cached: AllowList = EMPTY;

function allowList(): AllowList {
	const source = process.env.ALLOWED_SIGN_IN ?? "";
	if (source === cachedSource) return cached;

	const domains: string[] = [];
	const addresses: string[] = [];

	for (const raw of source.split(",")) {
		const entry = raw.trim().toLowerCase().replace(/^@/, "");
		if (!entry) continue;
		(entry.includes("@") ? addresses : domains).push(entry);
	}

	cachedSource = source;
	cached = { domains, addresses };
	return cached;
}

export function workspaceDomains(): readonly string[] {
	return allowList().domains;
}

export function primaryWorkspaceDomain(): string | undefined {
	return allowList().domains[0];
}

/**
 * The domain to pin Google's `hd` parameter to — ONLY when there is exactly one.
 *
 * `hd` makes Google itself refuse any account outside that hosted domain, before
 * the callback ever reaches us. With ALLOWED_SIGN_IN="techywebsolutions.com,
 * webability.io" the old code pinned it to domains[0], so the CRM advertised two
 * permitted domains and then rejected the second at Google with
 * "id token hosted domain (hd) \"webability.io\" does not satisfy the configured
 * \"hd\" option" — an error naming a setting the operator never set.
 *
 * Returning undefined for a multi-domain allow list is safe: `hd` is only a
 * pre-filter. The real gate is isWorkspaceEmail() in the sign-in hook, which
 * checks the whole list server-side and is unaffected.
 */
export function googleHostedDomain(): string | undefined {
	const { domains } = allowList();
	return domains.length === 1 ? domains[0] : undefined;
}

export function hasSignInAllowList(): boolean {
	const { domains, addresses } = allowList();
	return domains.length > 0 || addresses.length > 0;
}

export function isWorkspaceEmail(email: string | null | undefined): boolean {
	const value = email?.trim().toLowerCase();
	if (!value) return false;

	const parts = value.split("@");
	if (parts.length !== 2) return false;

	const [local, host] = parts;
	if (!local || !host) return false;

	const { domains, addresses } = allowList();

	if (addresses.includes(value)) return true;

	return domains.some(
		(domain) => host === domain || host.endsWith(`.${domain}`),
	);
}

import { AUTH_COOKIE_PREFIX } from "@crm/auth/cookies";

/**
 * Auth cookies are written with a Domain attribute when `AUTH_COOKIE_DOMAIN` is
 * set, but browsers keep cookies saved before that variable existed as
 * host-only. A domain-scoped `Set-Cookie` that clears the cookie cannot delete a
 * host-only twin, so sign-out appears to do nothing while the stale host-only
 * cookie keeps authenticating. Mirror every auth-cookie clearance without the
 * Domain attribute so both scopes are dropped.
 */
export function hostOnlyClearances(setCookies: readonly string[]): string[] {
	const clearances: string[] = [];
	const seen = new Set<string>();

	for (const cookie of setCookies) {
		const parts = cookie.split(";");
		const pair = parts[0] ?? "";
		const rawAttributes = parts.slice(1);
		const separator = pair.indexOf("=");
		if (separator === -1) continue;

		const name = pair.slice(0, separator).trim();
		const value = pair.slice(separator + 1).trim();
		const attributes = rawAttributes.map((attribute) => attribute.trim());

		const isAuthCookie =
			name.startsWith(`${AUTH_COOKIE_PREFIX}.`) ||
			name.startsWith(`__Secure-${AUTH_COOKIE_PREFIX}.`);
		const isCleared =
			value === "" && attributes.some((a) => a.toLowerCase() === "max-age=0");
		const hasDomain = attributes.some((a) =>
			a.toLowerCase().startsWith("domain="),
		);

		if (!isAuthCookie || !isCleared || !hasDomain || seen.has(name)) continue;

		seen.add(name);
		clearances.push(
			[
				`${name}=`,
				...attributes.filter((a) => !a.toLowerCase().startsWith("domain=")),
			].join("; "),
		);
	}

	return clearances;
}

import { describe, expect, test } from "bun:test";
import { hostOnlyClearances } from "./auth-cookie-clearance";

const CLEAR =
	"__Secure-crm.session_token=; Max-Age=0; Domain=.crm.example.com; Path=/; HttpOnly; Secure; SameSite=Lax";

describe("hostOnlyClearances", () => {
	test("mirrors a domain-scoped auth clearance as host-only", () => {
		expect(hostOnlyClearances([CLEAR])).toEqual([
			"__Secure-crm.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
		]);
	});

	test("covers every auth cookie the sign-out response clears", () => {
		const setCookies = [
			CLEAR,
			"__Secure-crm.session_data=; Max-Age=0; Domain=.crm.example.com; Path=/; HttpOnly; Secure; SameSite=Lax",
			"__Secure-crm.dont_remember=; Max-Age=0; Domain=.crm.example.com; Path=/; HttpOnly; Secure; SameSite=Lax",
		];
		expect(hostOnlyClearances(setCookies).map((c) => c.split("=")[0])).toEqual([
			"__Secure-crm.session_token",
			"__Secure-crm.session_data",
			"__Secure-crm.dont_remember",
		]);
	});

	test("ignores a cookie that is being set, not cleared", () => {
		expect(
			hostOnlyClearances([
				"__Secure-crm.session_token=abc.def; Max-Age=604800; Domain=.crm.example.com; Path=/; HttpOnly; Secure",
			]),
		).toEqual([]);
	});

	test("ignores non-auth cookies", () => {
		expect(
			hostOnlyClearances([
				"ph_phc_abc_posthog=; Max-Age=0; Domain=.crm.example.com; Path=/; Secure",
			]),
		).toEqual([]);
	});

	test("ignores a clearance with no Domain attribute", () => {
		expect(
			hostOnlyClearances([
				"__Secure-crm.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
			]),
		).toEqual([]);
	});

	test("emits one clearance per cookie name", () => {
		expect(hostOnlyClearances([CLEAR, CLEAR])).toHaveLength(1);
	});

	test("also clears the development cookie name", () => {
		expect(
			hostOnlyClearances([
				"crm.session_token=; Max-Age=0; Domain=.crm.example.com; Path=/; HttpOnly; SameSite=Lax",
			]),
		).toEqual([
			"crm.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
		]);
	});
});

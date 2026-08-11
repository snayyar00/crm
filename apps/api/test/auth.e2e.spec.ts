import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";

const fallback = (key: string, value: string) => {
	if (!process.env[key]) {
		process.env[key] = value;
	}
};

fallback(
	"DATABASE_URL",
	"postgresql://postgres:postgres@localhost:5432/crm?schema=public",
);
fallback("BETTER_AUTH_SECRET", "test-secret-at-least-32-characters-long");
fallback("API_URL", "http://localhost:3001");
fallback("ALLOWED_SIGN_IN", "example.com");
fallback("GOOGLE_CLIENT_ID", "test-google-client-id");
fallback("GOOGLE_CLIENT_SECRET", "test-google-client-secret");

describe("Auth (e2e)", () => {
	let app: INestApplication;

	beforeAll(async () => {
		const { AppModule } = await import("../src/app.module");

		const moduleFixture: TestingModule = await Test.createTestingModule({
			imports: [AppModule],
		}).compile();

		app = moduleFixture.createNestApplication({ bodyParser: false });
		await app.init();
	});

	afterAll(async () => {
		await app.close();
	});

	it("rejects an unauthenticated request to a guarded route", async () => {
		await request(app.getHttpServer()).get("/auth/me").expect(401);
	});

	it("allows an unauthenticated request to an optional-auth route", async () => {
		const response = await request(app.getHttpServer())
			.get("/auth/session")
			.expect(200);

		expect(response.body).toEqual({ authenticated: false, user: null });
	});

	it("mounts the Better Auth handler", async () => {
		const response = await request(app.getHttpServer()).get("/api/auth/ok");

		expect(response.status).not.toBe(404);
	});

	it("lets the sign-in page read what it may offer", async () => {
		const response = await request(app.getHttpServer())
			.get("/api/trpc/sso.signInOptions")
			.expect(200);

		// Assert with the SAME predicates the service uses, rather than re-deriving
		// them from process.env here. `google: true` was hard-coded, which made the
		// suite unpassable on any machine whose GOOGLE_CLIENT_ID is empty — it
		// blocked the pre-push hook and forced two production pushes through
		// --no-verify. Re-deriving from env is no better: this file seeds env at
		// module scope, and in a full run another spec can load the auth module
		// first, so a hand-rolled check and the app can disagree about the same
		// variable. Calling the exported predicate removes the disagreement by
		// construction.
		const { isGoogleConfigured, isMicrosoftConfigured } = await import(
			"@crm/auth"
		);

		expect(response.body.result.data).toEqual({
			google: isGoogleConfigured(),
			microsoft: isMicrosoftConfigured(),
			providers: [],
		});
	});

	it("keeps the SSO configuration itself behind the session", async () => {
		const response = await request(app.getHttpServer()).get(
			"/api/trpc/sso.settings",
		);

		expect(response.status).toBe(401);
	});
});

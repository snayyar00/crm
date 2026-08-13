import { createSign } from "node:crypto";
import { defineTool } from "eve/tools";
import { z } from "zod";

function base64url(buffer: Buffer): string {
	return buffer
		.toString("base64")
		.replace(/=/g, "")
		.replace(/\+/g, "-")
		.replace(/\//g, "_");
}

/** account-d for the demo environment, account for production. */
function authHost(): string {
	const base =
		process.env.DOCUSIGN_BASE_URL ?? "https://demo.docusign.net/restapi";
	return base.includes("demo")
		? "account-d.docusign.com"
		: "account.docusign.com";
}

function createJwt(
	clientId: string,
	userId: string,
	privateKeyPem: string,
): string {
	const header = { alg: "RS256", typ: "JWT" };
	const now = Math.floor(Date.now() / 1000);
	const payload = {
		iss: clientId,
		sub: userId,
		aud: authHost(),
		iat: now,
		exp: now + 3600,
		scope: "signature impersonation",
	};

	const encodedHeader = base64url(Buffer.from(JSON.stringify(header)));
	const encodedPayload = base64url(Buffer.from(JSON.stringify(payload)));
	const signingInput = `${encodedHeader}.${encodedPayload}`;

	const sign = createSign("RSA-SHA256");
	sign.update(signingInput);
	sign.end();
	const signature = sign.sign(privateKeyPem);

	return `${signingInput}.${base64url(signature)}`;
}

async function getAccessToken(
	jwt: string,
): Promise<{ token: string; baseUrl: string }> {
	const host = authHost();
	const res = await fetch(`https://${host}/oauth/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion: jwt,
		}),
	});

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`DocuSign auth failed (${res.status}): ${body}`);
	}

	const data = (await res.json()) as {
		access_token: string;
		expires_in: number;
	};

	const accountsRes = await fetch(`https://${host}/oauth/userinfo`, {
		headers: { Authorization: `Bearer ${data.access_token}` },
	});

	if (!accountsRes.ok) {
		throw new Error(
			`DocuSign userinfo failed (${accountsRes.status}): ${await accountsRes.text()}`,
		);
	}

	const userInfo = (await accountsRes.json()) as {
		accounts: Array<{
			account_id: string;
			base_uri: string;
			is_default: boolean;
		}>;
	};
	const account =
		userInfo.accounts.find((a) => a.is_default) ?? userInfo.accounts[0];

	return {
		token: data.access_token,
		baseUrl: account?.base_uri
			? `${account.base_uri}/restapi`
			: (process.env.DOCUSIGN_BASE_URL ?? "https://demo.docusign.net/restapi"),
	};
}

export default defineTool({
	description:
		"Create a DocuSign envelope from a generated SOW PDF as a DRAFT. Uploads the PDF, adds the client signer (and the WebAbility countersigner), and places signature/date tabs on the anchor strings the SOW template embeds (/sn1/ /dt1/ provider, /sn2/ /dt2/ client). The envelope is NOT emailed: it is created with status 'created' and must be sent by a human from the DocuSign UI, or by re-running with send=true ONLY after Sidharth's explicit per-envelope approval. Returns the envelope ID.",
	inputSchema: z.object({
		pdfPath: z
			.string()
			.min(1)
			.describe("Absolute path to the SOW PDF in the sandbox workspace"),
		sowRef: z.string().describe("SOW reference number for the email subject"),
		clientName: z.string().describe("Client company name"),
		signerName: z.string().describe("Client signer's full name"),
		signerEmail: z
			.string()
			.email()
			.describe("Client signer's email address (must match a real email)"),
		send: z
			.boolean()
			.default(false)
			.describe(
				"DANGER: true emails the envelope to the signer immediately. Requires Sidharth's explicit approval for THIS envelope. Default false creates a draft.",
			),
	}),
	async execute(input, ctx) {
		const clientId = process.env.DOCUSIGN_CLIENT_ID;
		const userId = process.env.DOCUSIGN_USER_ID;
		const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
		// .env stores the PEM one-line with literal \n; unescape if needed.
		const privateKey = process.env.DOCUSIGN_PRIVATE_KEY?.replace(/\\n/g, "\n");

		if (!clientId || !userId || !accountId || !privateKey) {
			return {
				error:
					"DocuSign not configured — set DOCUSIGN_CLIENT_ID, DOCUSIGN_USER_ID, DOCUSIGN_ACCOUNT_ID, and DOCUSIGN_PRIVATE_KEY in .env",
			};
		}

		try {
			const jwt = createJwt(clientId, userId, privateKey);
			const { token: accessToken, baseUrl } = await getAccessToken(jwt);

			const sandbox = await ctx.getSandbox();
			const pdfBytes = await sandbox.readBinaryFile({ path: input.pdfPath });
			if (!pdfBytes) {
				return { error: `PDF not found in sandbox: ${input.pdfPath}` };
			}
			const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

			const anchorTabs = (sn: string, dt: string) => ({
				signHereTabs: [
					{
						anchorString: sn,
						anchorUnits: "pixels",
						anchorXOffset: "0",
						anchorYOffset: "-20",
					},
				],
				dateSignedTabs: [
					{
						anchorString: dt,
						anchorUnits: "pixels",
						anchorXOffset: "0",
						anchorYOffset: "-10",
					},
				],
			});

			const providerName =
				process.env.DOCUSIGN_PROVIDER_SIGNER_NAME ?? "Sidharth Nayyar";
			const providerEmail =
				process.env.DOCUSIGN_PROVIDER_SIGNER_EMAIL ?? "support@webability.io";

			const envelope = {
				emailSubject: `${input.sowRef} — Statement of Work — ${input.clientName}`,
				emailBlurb:
					`Please review and sign the Statement of Work (${input.sowRef}) ` +
					`for accessibility services with WebAbility.`,
				documents: [
					{
						documentBase64: pdfBase64,
						name: `${input.sowRef}.pdf`,
						fileExtension: "pdf",
						documentId: "1",
					},
				],
				recipients: {
					signers: [
						{
							email: providerEmail,
							name: providerName,
							recipientId: "1",
							routingOrder: "1",
							tabs: anchorTabs("/sn1/", "/dt1/"),
						},
						{
							email: input.signerEmail,
							name: input.signerName,
							recipientId: "2",
							routingOrder: "2",
							tabs: anchorTabs("/sn2/", "/dt2/"),
						},
					],
				},
				// "created" = draft, nobody is emailed. "sent" requires explicit
				// per-envelope approval from Sidharth (send=true).
				status: input.send ? "sent" : "created",
			};

			const res = await fetch(
				`${baseUrl}/v2.1/accounts/${accountId}/envelopes`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${accessToken}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(envelope),
				},
			);

			if (!res.ok) {
				const body = await res.text();
				return {
					error: `DocuSign envelope creation failed (${res.status}): ${body}`,
				};
			}

			const result = (await res.json()) as {
				envelopeId: string;
				status: string;
				uri: string;
			};

			return {
				envelope_id: result.envelopeId,
				status: result.status,
				envelope_uri: result.uri,
				signer_email: input.signerEmail,
				signer_name: input.signerName,
				sow_ref: input.sowRef,
				note:
					result.status === "created"
						? "Draft only — nobody has been emailed. Send from the DocuSign UI or re-run with send=true after explicit approval."
						: "Envelope SENT — the signer has been emailed.",
			};
		} catch (err) {
			return {
				error: err instanceof Error ? err.message : String(err),
			};
		}
	},
});

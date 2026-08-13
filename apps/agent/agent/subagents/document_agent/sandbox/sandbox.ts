import { defineSandbox } from "eve/sandbox";

export default defineSandbox({
	async onSession({ use }) {
		const sandbox = await use({ networkPolicy: "deny-all" });
		await sandbox.run({ command: "which python3 && which google-chrome || which chromium || which chromium-browser || echo 'chrome-not-found'" });
	},
});

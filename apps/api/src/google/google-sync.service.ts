import { Injectable } from "@nestjs/common";
import {
	GOOGLE_SYNC_SOURCES,
	type GoogleSyncSource,
} from "../mailbox/mailbox.constants";
import { SyncStateService } from "../mailbox/sync-state.service";
import { CalendarSyncService } from "./calendar-sync.service";
import {
	type GmailBackfillReport,
	GmailSyncService,
} from "./gmail-sync.service";
import type { GmailBackfillInput } from "./google.contracts";

@Injectable()
export class GoogleSyncService {
	constructor(
		private readonly state: SyncStateService,
		private readonly calendar: CalendarSyncService,
		private readonly gmail: GmailSyncService,
	) {}

	async runOne(userId: string, source: GoogleSyncSource) {
		const row = await this.state.get(userId, source);
		if (!row) return null;

		return source === "calendar"
			? this.calendar.sync(row)
			: this.gmail.sync(row);
	}

	async backfillGmail(input: GmailBackfillInput): Promise<GmailBackfillReport> {
		return this.gmail.backfillPage(input);
	}

	async runForUser(userId: string): Promise<void> {
		for (const source of GOOGLE_SYNC_SOURCES) {
			await this.runOne(userId, source);
		}
	}
}

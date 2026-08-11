import { db } from "@crm/db";
import { isEmailConfigured } from "@crm/email";

const owner = (await db.user.findFirst({ orderBy: { createdAt: "asc" } }))!;
console.log("configured:", isEmailConfigured(), "| owner:", owner.email);

// 1. Draft — must NOT be sendable
const job = await db.emailJob.create({
  data: { to: ["sidharth15nayyar@gmail.com"], cc: [], subject: "CRM queue — end-to-end test",
    body: "Queued through the CRM's EmailJob table and sent by the dispatcher.\n\nIf you are reading this, scheduled automation works.\n\nSidharth",
    createdById: owner.id, status: "DRAFT" },
});
console.log("1. drafted:", job.id, job.status);

// 2. Dispatcher must ignore a DRAFT
const draftsPicked = await db.emailJob.count({ where: { status: "QUEUED" } });
console.log("2. QUEUED rows before release:", draftsPicked, "(dispatcher sees nothing)");

// 3. Release = the human approval step
await db.emailJob.update({ where: { id: job.id }, data: { status: "QUEUED" } });
console.log("3. released -> QUEUED");

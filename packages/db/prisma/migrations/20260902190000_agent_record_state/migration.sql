-- Where a deployed agent stands with one record.
--
-- Every scheduled run used to re-read all 40 leads to rediscover what the
-- previous run already knew (parked until October, no segment, AppSumo
-- support path) and write the same housekeeping note again. With per-record
-- state a run reads only what is new, changed, or due.
CREATE TYPE "AgentRecordStatus" AS ENUM ('ACTIVE', 'PARKED', 'BLOCKED', 'DONE');

CREATE TABLE "agentRecordState" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" "AgentRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "nextDueAt" TIMESTAMP(3),
    "lastReviewedAt" TIMESTAMP(3),
    "lastRunId" TEXT,
    "fingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agentRecordState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agentRecordState_agentId_targetType_targetId_key" ON "agentRecordState"("agentId", "targetType", "targetId");
CREATE INDEX "agentRecordState_agentId_nextDueAt_idx" ON "agentRecordState"("agentId", "nextDueAt");

ALTER TABLE "agentRecordState" ADD CONSTRAINT "agentRecordState_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agentDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

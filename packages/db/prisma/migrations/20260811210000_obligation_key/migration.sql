-- Give every obligation a STABLE identity, and let the database enforce it.
--
-- Obligations are Activity(TASK) rows carrying meta.obligationKind. Their identity
-- used to be the SUBJECT, which embeds the deal name ("Audit report — Hook Proof
-- — WCAG audit"). Renaming a deal and re-firing the CLOSED_WON hook therefore
-- minted five duplicate clocks. meta.obligationKey replaces that with text no
-- human edits: "<kind>:<slug>:<scope>_<id>".
--
-- Note the table is `activity`, lower-case, with quoted camelCase columns.

-- 1. Backfill. Slugs match what the service now emits. The four audit
--    deliverables are recognised by their title PREFIX — this is the only place
--    a slug is ever derived from text, and only because these rows predate the
--    key. Anything else (hand-made obligations such as "Send invoice + intake
--    questionnaire") keeps its own normalised subject as the slug, which is
--    stable for a row that already exists.
UPDATE "activity" SET meta = jsonb_set(
  coalesce(meta, '{}'::jsonb), '{obligationKey}', to_jsonb(
    (meta->>'obligationKind') || ':' ||
    CASE
      WHEN meta->>'obligationKind' = 'TRIAL_EXPIRY' THEN 'trial'
      WHEN meta->>'obligationKind' = 'RECHECK_DUE'  THEN 'recheck-6m'
      WHEN subject LIKE 'Audit report —%'                              THEN 'audit-report'
      WHEN subject LIKE 'VPAT / Accessibility Conformance Report —%'   THEN 'vpat'
      WHEN subject LIKE 'Accessibility statement —%'                   THEN 'statement'
      WHEN subject LIKE 'Remediation verification —%'                  THEN 'verification'
      ELSE lower(btrim(coalesce(subject, '')))
    END || ':' ||
    CASE
      WHEN meta->>'obligationKind' = 'TRIAL_EXPIRY'
        THEN 'company_' || coalesce("companyId", 'none')
      ELSE 'deal_' || coalesce("dealId", 'none')
    END
  ))
WHERE type = 'TASK' AND meta ? 'obligationKind';

-- 2. Retire pre-key duplicates so the index below can be created at all.
--    Completed, not deleted: a duplicate clock is still a record that someone
--    once created it, and this migration must not destroy history. Only OPEN
--    rows collide, and only the oldest of each key survives.
WITH ranked AS (
  SELECT id, row_number() OVER (
           PARTITION BY meta->>'obligationKey'
           ORDER BY "occurredAt" ASC, id ASC
         ) AS rn
  FROM "activity"
  WHERE type = 'TASK' AND meta ? 'obligationKey' AND "completedAt" IS NULL
)
UPDATE "activity" a
SET "completedAt" = now(),
    meta = jsonb_set(a.meta, '{supersededByMigration}', to_jsonb('20260811210000_obligation_key'::text))
FROM ranked r
WHERE a.id = r.id AND r.rn > 1;

-- 3. The constraint. Partial on completedAt IS NULL so a SATISFIED clock never
--    blocks the next one — a second trial next year must be creatable. This is
--    also the only thing that can close the find-then-create race between the
--    cron and a manual call; no amount of application code can.
CREATE UNIQUE INDEX IF NOT EXISTS "activity_obligation_key_open_uniq"
  ON "activity" ((meta->>'obligationKey'))
  WHERE type = 'TASK' AND meta->>'obligationKey' IS NOT NULL AND "completedAt" IS NULL;

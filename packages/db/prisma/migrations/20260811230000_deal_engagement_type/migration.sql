-- Distinguish a WCAG audit engagement from a widget subscription.
--
-- Winning a deal spawns five contractual obligations (audit report, VPAT,
-- accessibility statement, remediation verification, 6-month re-check). Nothing
-- in the schema said which deals actually carry those, so the hook treated every
-- won deal as an audit. On the real book that is 15 phantom obligations against
-- 5 true ones — and the daily alarm's whole premise is that silence means clean,
-- so a majority-false alarm destroys the instrument rather than just annoying.
--
-- NULLABLE with NO DEFAULT on purpose. A default of AUDIT would be wrong for
-- three of the four won deals; a default of SUBSCRIPTION would silently suppress
-- a real audit checklist. The application refuses to close a deal as WON while
-- this is unknown, the same way it already refuses to close one as LOST without
-- a reason.
CREATE TYPE "EngagementType" AS ENUM ('AUDIT', 'SUBSCRIPTION', 'OTHER');
ALTER TABLE "deal" ADD COLUMN "engagementType" "EngagementType";

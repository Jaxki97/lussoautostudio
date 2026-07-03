-- =============================================================================
-- Migration 0002 — Reference label on membership applications (label only)
--
-- Apply to production:
--   npx wrangler d1 execute lusso_bookings --remote --file migrations/0002_membership_ref.sql
-- =============================================================================

ALTER TABLE membership_applications ADD COLUMN ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mem_ref ON membership_applications(ref);

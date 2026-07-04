-- =============================================================================
-- Migration 0004 — Capture address on membership applications
--
-- Apply to production:
--   npx wrangler d1 execute lusso_bookings --remote --file migrations/0004_membership_address.sql
-- =============================================================================

ALTER TABLE membership_applications ADD COLUMN address TEXT;

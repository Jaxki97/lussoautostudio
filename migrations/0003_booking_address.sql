-- =============================================================================
-- Migration 0003 — Capture service address on bookings (mobile detailing)
--
-- Apply to production:
--   npx wrangler d1 execute lusso_bookings --remote --file migrations/0003_booking_address.sql
-- =============================================================================

ALTER TABLE bookings ADD COLUMN address TEXT;

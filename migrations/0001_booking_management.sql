-- =============================================================================
-- Migration 0001 — Booking Management feature
-- Adds reference numbers, deposit state, event log to bookings,
-- plus manage_tokens (magic links) and otp_codes (email OTP fallback).
--
-- Apply to production:
--   npx wrangler d1 execute lusso_bookings --remote --file migrations/0001_booking_management.sql
-- =============================================================================

ALTER TABLE bookings ADD COLUMN ref TEXT;
ALTER TABLE bookings ADD COLUMN reschedule_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN event_log TEXT NOT NULL DEFAULT '[]';
ALTER TABLE bookings ADD COLUMN deposit_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE bookings ADD COLUMN deposit_amount_cents INTEGER NOT NULL DEFAULT 5000;
ALTER TABLE bookings ADD COLUMN square_payment_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_ref ON bookings(ref);

CREATE TABLE IF NOT EXISTS manage_tokens (
  token       TEXT PRIMARY KEY,
  booking_id  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_manage_tokens_booking ON manage_tokens(booking_id);

CREATE TABLE IF NOT EXISTS otp_codes (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  consumed    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  request_ip  TEXT
);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email);

// =============================================================================
// POST /api/manage/verify-otp   { email, code }
// On success: issues a manage token (or a booking chooser when the email has
// several upcoming bookings). Codes lock after 4 wrong attempts.
// =============================================================================

import {
  CORS_HEADERS, json, getOrCreateManageToken,
} from "../_shared.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function torontoToday() {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" });
  return dtf.format(new Date());
}

const WRONG  = "That code isn't right. Please try again.";
const LOCKED = "Too many attempts. Request a new code to continue.";

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: WRONG }, 400); }

  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 254);
  const code  = String(body.code ?? "").trim();
  if (!email || !/^\d{6}$/.test(code)) {
    return json({ ok: false, error: WRONG }, 400);
  }

  try {
    const now = new Date().toISOString();
    const row = await env.DB.prepare(
      `SELECT id, code_hash, attempts FROM otp_codes
        WHERE email = ? AND consumed = 0 AND expires_at > ?
        ORDER BY created_at DESC LIMIT 1`
    ).bind(email, now).first();

    if (!row) return json({ ok: false, error: WRONG }, 401);
    if (row.attempts >= 4) {
      await env.DB.prepare("UPDATE otp_codes SET consumed = 1 WHERE id = ?").bind(row.id).run();
      return json({ ok: false, error: LOCKED }, 429);
    }

    const hash = await sha256Hex(code);
    if (hash !== row.code_hash) {
      const attempts = row.attempts + 1;
      await env.DB.prepare(
        `UPDATE otp_codes SET attempts = ?, consumed = CASE WHEN ? >= 4 THEN 1 ELSE consumed END WHERE id = ?`
      ).bind(attempts, attempts, row.id).run();
      return json({ ok: false, error: attempts >= 4 ? LOCKED : WRONG }, attempts >= 4 ? 429 : 401);
    }

    // Success — consume the code, resolve upcoming bookings
    await env.DB.prepare("UPDATE otp_codes SET consumed = 1 WHERE id = ?").bind(row.id).run();

    const { results: bookings } = await env.DB.prepare(
      `SELECT * FROM bookings
        WHERE lower(email) = ? AND status = 'active' AND date >= ?
        ORDER BY date ASC, start_hour ASC`
    ).bind(email, torontoToday()).all();

    if (!bookings.length) {
      return json({ ok: true, bookings: [] });
    }

    const list = [];
    for (const b of bookings) {
      const token = await getOrCreateManageToken(env, b);
      list.push({ ref: b.ref, service: b.service, date: b.date, start_hour: b.start_hour, token });
    }

    if (list.length === 1) {
      return json({ ok: true, token: list[0].token });
    }
    return json({ ok: true, bookings: list });
  } catch (e) {
    console.error("[manage/verify-otp] error:", e?.message ?? e);
    return json({ ok: false, error: "Something went wrong on our end. Please try again in a moment." }, 500);
  }
}

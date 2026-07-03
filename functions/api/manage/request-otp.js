// =============================================================================
// POST /api/manage/request-otp   { email }
// Lost-link fallback. ALWAYS returns the identical neutral message so email
// existence can never be probed. Rate-limited per email and per IP.
// =============================================================================

import { CORS_HEADERS, json, sendEmail, emailOtpCode } from "../_shared.js";

const NEUTRAL = "If a booking exists for that email, we've sent a code. It expires in 10 minutes.";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function torontoToday() {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" });
  return dtf.format(new Date()); // YYYY-MM-DD
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: true, message: NEUTRAL }); }

  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 254);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: true, message: NEUTRAL }); // neutral even for garbage input
  }

  try {
    const ip = request.headers.get("cf-connecting-ip") || "";
    const windowStart = new Date(Date.now() - 15 * 60_000).toISOString();

    // Rate limits: 3 / email / 15 min, 5 / IP / 15 min — fail silent + neutral
    const [byEmail, byIp] = await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) AS c FROM otp_codes WHERE email = ? AND created_at > ?").bind(email, windowStart),
      env.DB.prepare("SELECT COUNT(*) AS c FROM otp_codes WHERE request_ip = ? AND request_ip != '' AND created_at > ?").bind(ip, windowStart),
    ]);
    if ((byEmail.results?.[0]?.c ?? 0) >= 3 || (byIp.results?.[0]?.c ?? 0) >= 5) {
      return json({ ok: true, message: NEUTRAL });
    }

    // Only send if an active upcoming booking exists — response stays neutral either way
    const hasBooking = await env.DB.prepare(
      `SELECT 1 FROM bookings WHERE lower(email) = ? AND status = 'active' AND date >= ? LIMIT 1`
    ).bind(email, torontoToday()).first();

    if (hasBooking) {
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
      const now = new Date();
      await env.DB.prepare(
        `INSERT INTO otp_codes (id, email, code_hash, attempts, expires_at, consumed, created_at, request_ip)
         VALUES (?, ?, ?, 0, ?, 0, ?, ?)`
      ).bind(
        crypto.randomUUID(), email, await sha256Hex(code),
        new Date(now.getTime() + 10 * 60_000).toISOString(),
        now.toISOString(), ip
      ).run();

      const mail = emailOtpCode(code);
      await sendEmail(env, email, mail.subject, mail.html);
    }

    return json({ ok: true, message: NEUTRAL });
  } catch (e) {
    console.error("[manage/request-otp] error:", e?.message ?? e);
    return json({ ok: true, message: NEUTRAL }); // never leak errors here
  }
}

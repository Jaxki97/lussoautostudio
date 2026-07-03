// =============================================================================
// /functions/api/_shared.js — shared helpers for the booking-management feature
// (underscore prefix keeps this file out of Pages Functions routing)
//
// Covers: time/cutoff math (DST-aware), reference numbers, manage tokens,
// slot validation, the atomic reschedule swap, Square deposit stubs, and
// the branded email templates from the copy deck.
// =============================================================================

export const CORS_HEADERS = {
  "access-control-allow-origin": "https://lussoautostudio.ca",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-admin-token",
};

export const SERVICES = {
  "Maintenance Wash":    1,
  "Interior Deep Clean": 2,
  "Full Detail":         4,
};

export const DEFAULT_OPEN_HOUR  = 8;
export const DEFAULT_CLOSE_HOUR = 20;
export const RESCHEDULE_CAP     = 2;
export const CONTACT_PHONE      = "";
export const CONTACT_EMAIL      = "bookings@lussoautostudio.ca";

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

// ── Time & cutoff (America/Toronto, DST-aware) ───────────────────────────────

// Returns the UTC epoch ms for a wall-clock time in an IANA zone.
export function zonedWallTimeToUtcMs(year, month, day, hour, tz = "America/Toronto") {
  const guess = Date.UTC(year, month - 1, day, hour, 0, 0);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(guess)).map(x => [x.type, x.value]));
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  const offset = asIfUtc - guess;
  return guess - offset;
}

export function appointmentUtcMs(dateStr, startHour) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return zonedWallTimeToUtcMs(y, m, d, startHour);
}

export function noticeHours(dateStr, startHour) {
  return (appointmentUtcMs(dateStr, startHour) - Date.now()) / 3_600_000;
}

// "Fri, Jul 10 at 1:00 PM" for a UTC ms instant, rendered in Toronto time
export function formatTorontoInstant(utcMs) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
  return `${p.weekday}, ${p.month} ${p.day} at ${p.hour}:${p.minute} ${p.dayPeriod.toUpperCase().replace(/\./g, "")}`;
}

export function formatHour(h) {
  const period = h >= 12 ? "PM" : "AM";
  const hr = ((h + 11) % 12) + 1;
  return `${hr}:00 ${period}`;
}

export function formatDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const days   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const dow    = new Date(y, m - 1, d).getDay();
  return `${days[dow]}, ${months[m-1]} ${d}, ${y}`;
}

// ── Reference numbers (§5) ───────────────────────────────────────────────────

const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // confusable-free

export function generateRef(type = "B") {
  // Toronto local date for the label
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", year: "2-digit", month: "2-digit", day: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date()).map(x => [x.type, x.value]));
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  let suffix = "";
  for (const b of bytes) suffix += REF_ALPHABET[b % REF_ALPHABET.length];
  return `LAS-${type}-${p.year}${p.month}${p.day}-${suffix}`;
}

// ── Manage tokens (§7.1) ─────────────────────────────────────────────────────

export function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(20)); // 160 bits
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// One active token per booking. Links are capped at 24h from issue (owner's
// choice) — the email-OTP door is the main return path after that. Each new
// email refreshes the 24h window; a link never outlives the appointment
// (+2h grace).
export async function getOrCreateManageToken(env, booking) {
  const apptCapMs = appointmentUtcMs(booking.date, booking.start_hour) + 2 * 3_600_000;
  const expiresAt = new Date(Math.min(Date.now() + 24 * 3_600_000, apptCapMs)).toISOString();
  const now = new Date().toISOString();

  const existing = await env.DB.prepare(
    `SELECT token FROM manage_tokens
      WHERE booking_id = ? AND revoked = 0 AND expires_at > ?
      ORDER BY created_at DESC LIMIT 1`
  ).bind(booking.id, now).first();

  if (existing) {
    await env.DB.prepare(
      `UPDATE manage_tokens SET expires_at = ? WHERE token = ?`
    ).bind(expiresAt, existing.token).run();
    return existing.token;
  }

  const token = generateToken();
  await env.DB.prepare(
    `INSERT INTO manage_tokens (token, booking_id, expires_at, created_at, revoked)
     VALUES (?, ?, ?, ?, 0)`
  ).bind(token, booking.id, expiresAt, now).run();
  return token;
}

export function manageLink(token) {
  return `https://lussoautostudio.ca/manage?token=${token}`;
}

// Resolve a token to its active booking, or null.
export async function resolveToken(env, token) {
  if (!token || typeof token !== "string" || token.length < 20 || token.length > 64) return null;
  const now = new Date().toISOString();
  return env.DB.prepare(
    `SELECT b.* FROM manage_tokens t
       JOIN bookings b ON b.id = t.booking_id
      WHERE t.token = ? AND t.revoked = 0 AND t.expires_at > ?`
  ).bind(token, now).first();
}

// ── Target-slot validation (shared by customer + admin reschedule) ───────────
// Mirrors book.js rules: weekend-only, 30-day window, blocked dates,
// open/close hours + per-date overrides. Returns { ok } or { ok:false, error }.
export async function validateTargetSlot(env, date, start_hour, duration_hours) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Invalid date." };
  if (!Number.isInteger(start_hour))     return { ok: false, error: "Invalid time." };

  const d = new Date(`${date}T00:00:00Z`);
  if (isNaN(d.getTime())) return { ok: false, error: "Invalid date." };
  const dow = d.getUTCDay();
  if (dow !== 0 && dow !== 6) return { ok: false, error: "Appointments are available on weekends only." };

  const todayUTC = new Date(); todayUTC.setUTCHours(0, 0, 0, 0);
  const diffDays = (d.getTime() - todayUTC.getTime()) / 86_400_000;
  if (diffDays < 0)  return { ok: false, error: "That date has passed." };
  if (diffDays > 30) return { ok: false, error: "Appointments can be booked up to 30 days ahead." };

  // Must be in the future (not just today's past hours)
  if (appointmentUtcMs(date, start_hour) <= Date.now()) {
    return { ok: false, error: "That time has passed." };
  }

  const { results: sRows } = await env.DB.prepare(
    "SELECT key, value FROM availability_settings"
  ).all();
  const sm = Object.fromEntries(sRows.map(r => [r.key, r.value]));
  const OPEN_HOUR  = parseInt(sm.open_hour  ?? String(DEFAULT_OPEN_HOUR),  10);
  const CLOSE_HOUR = parseInt(sm.close_hour ?? String(DEFAULT_CLOSE_HOUR), 10);

  const blockedDates = JSON.parse(sm.blocked_dates ?? "[]");
  if (blockedDates.includes(date)) return { ok: false, error: "That date is unavailable." };

  const end_hour = start_hour + duration_hours;
  const overrides = JSON.parse(sm.hour_overrides ?? "{}");
  const dateOverride = overrides[date];
  if (dateOverride) {
    const availableSet = new Set(dateOverride);
    for (let h = start_hour; h < end_hour; h++) {
      if (!availableSet.has(h)) return { ok: false, error: "That time is unavailable." };
    }
  } else {
    if (start_hour < OPEN_HOUR || end_hour > CLOSE_HOUR) {
      return { ok: false, error: "That time is outside our hours." };
    }
  }
  return { ok: true, end_hour };
}

// ── Atomic reschedule swap ───────────────────────────────────────────────────
// Single guarded UPDATE: moves the booking only if the target range is still
// free of other active bookings. Appends the event and (optionally) increments
// reschedule_count in the same statement, so there is no double-book window.
// Returns true if the swap happened, false if the slot was taken mid-flow.
export async function atomicSwap(env, bookingId, newDate, newStart, newEnd, event, { incrementCount = false, depositStatus = null, squarePaymentId = undefined } = {}) {
  const sets = [
    "date = ?1", "start_hour = ?2", "end_hour = ?3",
    "event_log = json_insert(event_log, '$[#]', json(?5))",
  ];
  if (incrementCount) sets.push("reschedule_count = reschedule_count + 1");
  if (depositStatus)  sets.push(`deposit_status = '${depositStatus}'`); // internal enum, not user input
  if (squarePaymentId !== undefined) sets.push("square_payment_id = ?6");

  let stmt = env.DB.prepare(
    `UPDATE bookings SET ${sets.join(", ")}
      WHERE id = ?4 AND status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM bookings b2
           WHERE b2.id != ?4 AND b2.date = ?1 AND b2.status = 'active'
             AND NOT (b2.end_hour <= ?2 OR b2.start_hour >= ?3)
        )`
  );
  stmt = squarePaymentId !== undefined
    ? stmt.bind(newDate, newStart, newEnd, bookingId, JSON.stringify(event), squarePaymentId)
    : stmt.bind(newDate, newStart, newEnd, bookingId, JSON.stringify(event));
  const res = await stmt.run();

  return (res.meta?.changes ?? 0) > 0;
}

export async function appendEvent(env, bookingId, event) {
  await env.DB.prepare(
    `UPDATE bookings SET event_log = json_insert(event_log, '$[#]', json(?)) WHERE id = ?`
  ).bind(JSON.stringify(event), bookingId).run();
}

// ── Square integration (§11) ─────────────────────────────────────────────────
// Card data never touches this server: the browser tokenizes via Square's
// Web Payments SDK and we only ever handle the one-time source_id token and
// the resulting payment id. Falls back to logged no-op stubs when creds are
// absent (e.g. production before go-live), so the state machine keeps working.

export function squareConfigured(env) {
  return Boolean(env.SQUARE_ACCESS_TOKEN && env.SQUARE_LOCATION_ID);
}

function squareBase(env) {
  return env.SQUARE_ENVIRONMENT === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

async function squareRequest(env, path, body) {
  const res = await fetch(`${squareBase(env)}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      "Square-Version": "2025-05-21",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[square] ${path} failed:`, JSON.stringify(data.errors ?? data).slice(0, 500));
    return { ok: false, errors: data.errors };
  }
  return { ok: true, data };
}

// Charges the deposit against a one-time card token from the browser.
// Returns { ok, square_payment_id }.
export async function collectDeposit(booking, env, sourceId) {
  if (!squareConfigured(env)) {
    console.log(`[square:stub] collectDeposit ${booking.id} $${(booking.deposit_amount_cents ?? 5000) / 100}`);
    return { ok: true, square_payment_id: null };
  }
  if (!sourceId) return { ok: false };

  const r = await squareRequest(env, "/v2/payments", {
    source_id: sourceId,
    idempotency_key: crypto.randomUUID(),
    amount_money: { amount: booking.deposit_amount_cents ?? 5000, currency: "CAD" },
    location_id: env.SQUARE_LOCATION_ID,
    note: `Lusso deposit ${booking.ref ?? booking.id}`,
    autocomplete: true,
  });
  if (!r.ok) return { ok: false };
  return { ok: true, square_payment_id: r.data.payment?.id ?? null };
}

export async function refundDeposit(booking, env) {
  if (!squareConfigured(env) || !booking.square_payment_id) {
    console.log(`[square:stub] refundDeposit ${booking.id}`);
    return { ok: true };
  }
  const r = await squareRequest(env, "/v2/refunds", {
    idempotency_key: crypto.randomUUID(),
    payment_id: booking.square_payment_id,
    amount_money: { amount: booking.deposit_amount_cents ?? 5000, currency: "CAD" },
    reason: `Lusso deposit refund ${booking.ref ?? booking.id}`,
  });
  return { ok: r.ok };
}

// No API call — Square keeps the captured funds; state change only.
export async function forfeitDeposit(booking, env) {
  console.log(`[square] forfeitDeposit ${booking.id} — funds retained, state change only`);
  return { ok: true };
}

// ── Email plumbing ───────────────────────────────────────────────────────────

export async function sendEmail(env, to, subject, html) {
  if (!env.RESEND_API_KEY || !to) return;
  const fromEmail = env.FROM_EMAIL || "onboarding@resend.dev";
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromEmail, to: [to], subject, html }),
    });
  } catch (e) {
    console.error("[email] Resend failed:", e?.message ?? e);
  }
}

export function esc(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Brand shell matching the existing confirmation emails
export function emailShell(heading, bodyHtml, footerText) {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;background:#09090b;color:#ece9e2;border-radius:16px;overflow:hidden;border:1px solid rgba(199,167,106,.20)">
      <div style="background:linear-gradient(135deg,rgba(199,167,106,.15),rgba(199,167,106,.05));padding:24px 28px;border-bottom:1px solid rgba(199,167,106,.15)">
        <p style="margin:0;font-size:11px;letter-spacing:.25em;text-transform:uppercase;color:#a8894e">Lusso Auto Studio</p>
        <h1 style="margin:8px 0 0;font-size:22px;font-weight:600;color:#c7a76a">${heading}</h1>
      </div>
      <div style="padding:24px 28px">${bodyHtml}</div>
      <div style="padding:16px 28px;border-top:1px solid rgba(255,255,255,.07);font-size:11px;color:rgba(255,255,255,.30)">
        ${footerText} · Lusso Auto Studio · lussoautostudio.ca
      </div>
    </div>`;
}

export function manageButton(link) {
  return `<div style="margin:22px 0 4px"><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:12px;background:#c7a76a;color:#09090b;font-size:14px;font-weight:700;text-decoration:none">Manage your appointment</a></div>`;
}

const P  = `style="margin:0 0 16px;color:rgba(255,255,255,.70);line-height:1.7;font-size:14px"`;
const SIGN = `<p style="margin:20px 0 0;color:rgba(255,255,255,.45);font-size:13px">— Lusso Auto Studio</p>`;

// ── Customer emails (copy deck §1) ───────────────────────────────────────────

// §1.2 — on-time reschedule; also used verbatim for admin reschedule
export function emailRescheduleOnTime(b, link) {
  const body = `
    <p ${P}>Hi ${esc(b.name)},</p>
    <p ${P}>Your appointment is now set for <b style="color:#c7a76a">${formatDate(b.date)} at ${formatHour(b.start_hour)}</b>.</p>
    <p ${P}>Your reference remains ${esc(b.ref)}. Everything else stays as arranged.</p>
    ${manageButton(link)}
    ${SIGN}`;
  return {
    subject: "Your appointment has been rescheduled",
    html: emailShell("Appointment Rescheduled", body, `Reference ${esc(b.ref)}`),
  };
}

// §1.3 — reschedule within 24 hours (new deposit secured)
export function emailRescheduleLate(b, link) {
  const body = `
    <p ${P}>Hi ${esc(b.name)},</p>
    <p ${P}>Your appointment is now set for <b style="color:#c7a76a">${formatDate(b.date)} at ${formatHour(b.start_hour)}</b>.</p>
    <p ${P}>A $50 deposit secures the new time and will be applied to your service. Your reference remains ${esc(b.ref)}.</p>
    ${manageButton(link)}
    ${SIGN}`;
  return {
    subject: "Your appointment has been rescheduled",
    html: emailShell("Appointment Rescheduled", body, `Reference ${esc(b.ref)}`),
  };
}

// §1.4 — cancellation, deposit refunded (≥24h)
export function emailCancelRefunded(b) {
  const body = `
    <p ${P}>Hi ${esc(b.name)},</p>
    <p ${P}>Your appointment on <b>${formatDate(b.date)} at ${formatHour(b.start_hour)}</b> has been cancelled, and the time released.</p>
    <p ${P}>Your $50 deposit will be refunded in full. Nothing further is needed.</p>
    <p ${P}>When you'd like to book again, we're here.</p>
    ${SIGN}`;
  return {
    subject: "Your appointment has been cancelled",
    html: emailShell("Appointment Cancelled", body, `Reference ${esc(b.ref)}`),
  };
}

// §1.5 — cancellation, deposit retained (<24h)
export function emailCancelRetained(b) {
  const body = `
    <p ${P}>Hi ${esc(b.name)},</p>
    <p ${P}>Your appointment on <b>${formatDate(b.date)} at ${formatHour(b.start_hour)}</b> has been cancelled, and the time released.</p>
    <p ${P}>As the change came within 24 hours, your $50 deposit has been applied to the time we'd reserved for you. Nothing further is needed.</p>
    <p ${P}>When you'd like to book again, we're here.</p>
    ${SIGN}`;
  return {
    subject: "Your appointment has been cancelled",
    html: emailShell("Appointment Cancelled", body, `Reference ${esc(b.ref)}`),
  };
}

// §1.6 — access code (email OTP)
export function emailOtpCode(code) {
  const body = `
    <p ${P}>Hi,</p>
    <p ${P}>Your access code is <b style="color:#c7a76a;font-size:20px;letter-spacing:.15em">${esc(code)}</b>. It expires in 10 minutes.</p>
    <p ${P}>Enter it on the page where you requested it to manage your appointment. If you didn't request this, you can ignore this message.</p>
    ${SIGN}`;
  return {
    subject: "Your Lusso access code",
    html: emailShell("Your Access Code", body, "Access code"),
  };
}

// ── Owner emails (copy deck §2 — plain and scannable) ────────────────────────

export function ownerLine(env, subject, line) {
  return sendEmail(env, env.NOTIFY_EMAIL, subject,
    `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111;line-height:1.6">${line}</div>`);
}

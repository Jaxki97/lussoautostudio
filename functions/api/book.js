// =============================================================================
// /functions/api/book.js  —  Creates a booking + sends owner email via Resend
//
// Required Cloudflare environment variables (set in Pages → Settings → Variables):
//   RESEND_API_KEY   → your Resend API key (from resend.com)
//   NOTIFY_EMAIL     → the email address you want booking notifications sent TO
//   FROM_EMAIL       → the "from" address (must be a verified domain in Resend,
//                      e.g. bookings@lussoautostudio.ca — or use Resend's free
//                      onboarding address: onboarding@resend.dev for testing)
// =============================================================================

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const OPEN_HOUR  = 8;
const CLOSE_HOUR = 20;

const SERVICES = {
  "Maintenance Wash":    1,
  "Interior Deep Clean": 2,
  "Full Detail":         4,
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

function sanitize(value, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, 500) : fallback;
}

function formatHour(h) {
  const period = h >= 12 ? "PM" : "AM";
  const hr = ((h + 11) % 12) + 1;
  return `${hr}:00 ${period}`;
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const days   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const dow    = new Date(y, m - 1, d).getDay();
  return `${days[dow]}, ${months[m-1]} ${d}, ${y}`;
}

// ── Email sender ──────────────────────────────────────────────────────────────
async function sendBookingEmail(booking, env) {
  // Silently skip if Resend isn't configured yet
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) return;

  const fromEmail = env.FROM_EMAIL || "onboarding@resend.dev";
  const dateLabel = formatDate(booking.date);
  const timeLabel = `${formatHour(booking.start_hour)} – ${formatHour(booking.end_hour)}`;

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;background:#09090b;color:#ece9e2;border-radius:16px;overflow:hidden;border:1px solid rgba(199,167,106,.20)">
      <div style="background:linear-gradient(135deg,rgba(199,167,106,.15),rgba(199,167,106,.05));padding:24px 28px;border-bottom:1px solid rgba(199,167,106,.15)">
        <p style="margin:0;font-size:11px;letter-spacing:.25em;text-transform:uppercase;color:#a8894e">Lusso Auto Studio</p>
        <h1 style="margin:8px 0 0;font-size:22px;font-weight:600;color:#c7a76a">New Booking Confirmed</h1>
      </div>
      <div style="padding:24px 28px">
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px 0;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em;width:110px">Date</td><td style="padding:8px 0;font-size:14px;font-weight:600">${dateLabel}</td></tr>
          <tr><td style="padding:8px 0;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em">Time</td><td style="padding:8px 0;font-size:14px;font-weight:600;color:#c7a76a">${timeLabel}</td></tr>
          <tr><td style="padding:8px 0;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em">Service</td><td style="padding:8px 0;font-size:14px">${booking.service}</td></tr>
          <tr style="border-top:1px solid rgba(255,255,255,.07)"><td style="padding:12px 0 8px;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em">Client</td><td style="padding:12px 0 8px;font-size:14px;font-weight:600">${booking.name}</td></tr>
          <tr><td style="padding:8px 0;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em">Phone</td><td style="padding:8px 0;font-size:14px"><a href="tel:${booking.phone}" style="color:#c7a76a">${booking.phone}</a></td></tr>
          <tr><td style="padding:8px 0;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em">Vehicle</td><td style="padding:8px 0;font-size:14px">${booking.vehicle}</td></tr>
          <tr><td style="padding:8px 0;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em">City</td><td style="padding:8px 0;font-size:14px">${booking.city || "—"}</td></tr>
          ${booking.notes ? `<tr style="border-top:1px solid rgba(255,255,255,.07)"><td style="padding:12px 0 8px;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em">Notes</td><td style="padding:12px 0 8px;font-size:13px;color:rgba(255,255,255,.65)">${booking.notes}</td></tr>` : ""}
        </table>
      </div>
      <div style="padding:16px 28px;border-top:1px solid rgba(255,255,255,.07);font-size:11px;color:rgba(255,255,255,.30)">
        Booking ID: ${booking.id} · Lusso Auto Studio Admin
      </div>
    </div>`;

  try {
    await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        from:    fromEmail,
        to:      [env.NOTIFY_EMAIL],
        subject: `📅 New Booking — ${booking.name} · ${dateLabel} at ${formatHour(booking.start_hour)}`,
        html,
      }),
    });
    // We intentionally don't throw if Resend fails — booking is already saved,
    // a failed notification shouldn't fail the whole request.
  } catch (e) {
    console.error("Resend email failed:", e?.message ?? e);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Request body must be valid JSON" }, 400);
  }

  const date           = sanitize(body.date);
  const service        = sanitize(body.service);
  const name           = sanitize(body.name);
  const phone          = sanitize(body.phone);
  const vehicle        = sanitize(body.vehicle);
  const city           = sanitize(body.city);
  const notes          = sanitize(body.notes);
  const start_hour     = Number(body.start_hour);
  const duration_hours = Number(body.duration_hours);

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ ok: false, error: "Missing or invalid date (expect YYYY-MM-DD)" }, 400);
  }
  if (!Number.isInteger(start_hour) || start_hour < OPEN_HOUR || start_hour >= CLOSE_HOUR) {
    return json({ ok: false, error: `start_hour must be between ${OPEN_HOUR} and ${CLOSE_HOUR - 1}` }, 400);
  }
  if (!SERVICES[service]) {
    return json({ ok: false, error: `Unknown service. Valid: ${Object.keys(SERVICES).join(", ")}` }, 400);
  }
  const expectedDuration = SERVICES[service];
  if (duration_hours !== expectedDuration) {
    return json({ ok: false, error: `Duration mismatch: "${service}" requires ${expectedDuration} hr(s)` }, 400);
  }
  const end_hour = start_hour + duration_hours;
  if (end_hour > CLOSE_HOUR) {
    return json({ ok: false, error: `Booking would end at ${end_hour}:00, past closing (${CLOSE_HOUR}:00)` }, 400);
  }
  if (!name)    return json({ ok: false, error: "Name is required" }, 400);
  if (!phone)   return json({ ok: false, error: "Phone is required" }, 400);
  if (!vehicle) return json({ ok: false, error: "Vehicle is required" }, 400);

  // ── Date rules ──────────────────────────────────────────────────────────────
  const d = new Date(`${date}T00:00:00Z`);
  if (isNaN(d.getTime())) return json({ ok: false, error: "Invalid date" }, 400);

  const dow = d.getUTCDay();
  if (dow !== 0 && dow !== 6) {
    return json({ ok: false, error: "Bookings are only available on weekends" }, 400);
  }
  const todayUTC = new Date(); todayUTC.setUTCHours(0, 0, 0, 0);
  const diffDays = (d.getTime() - todayUTC.getTime()) / 86_400_000;
  if (diffDays < 0)  return json({ ok: false, error: "Cannot book a date in the past" }, 400);
  if (diffDays > 30) return json({ ok: false, error: "Bookings can only be made up to 30 days ahead" }, 400);

  // ── Overlap check ───────────────────────────────────────────────────────────
  try {
    const overlap = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM bookings
        WHERE date = ? AND status = 'active'
          AND NOT (end_hour <= ? OR start_hour >= ?)`
    ).bind(date, start_hour, end_hour).first();

    if ((overlap?.c ?? 0) > 0) {
      return json({ ok: false, error: "That time slot is no longer available. Please choose another time." }, 409);
    }
  } catch (e) {
    return json({ ok: false, error: "Database error during overlap check", details: String(e?.message ?? e) }, 500);
  }

  // ── Insert ──────────────────────────────────────────────────────────────────
  const id         = crypto.randomUUID();
  const created_at = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO bookings
         (id, date, start_hour, duration_hours, end_hour,
          service, name, phone, vehicle, city, notes, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
    ).bind(id, date, start_hour, duration_hours, end_hour, service, name, phone, vehicle, city, notes, created_at).run();
  } catch (e) {
    return json({ ok: false, error: "Failed to save booking", details: String(e?.message ?? e) }, 500);
  }

  // ── Send notification email (non-blocking) ──────────────────────────────────
  await sendBookingEmail({ id, date, start_hour, end_hour, service, name, phone, vehicle, city, notes }, env);

  return json({ ok: true, id, date, start_hour, end_hour, service }, 201);
}

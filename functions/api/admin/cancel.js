// =============================================================================
// /functions/api/admin/cancel.js
// POST /api/admin/cancel  { id: "<uuid>" }  →  sets booking status to cancelled
//
// PROTECTED: Requires x-admin-token header matching the ADMIN_TOKEN secret.
// =============================================================================

const CORS_HEADERS = {
  "access-control-allow-origin": "https://lussoautostudio.ca",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-admin-token",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost({ request, env }) {
  // ── Auth check ──────────────────────────────────────────────────────────────
  const token = request.headers.get("x-admin-token");
  if (!token || token !== env.ADMIN_TOKEN) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  // ── Parse body ───────────────────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const id = String(body.id || "").trim();
  if (!id) return json({ ok: false, error: "Missing booking id" }, 400);

  // ── Fetch booking details for cancellation email ─────────────────────────────
  let booking;
  try {
    booking = await env.DB.prepare(
      `SELECT name, email, date, start_hour, end_hour, service FROM bookings WHERE id = ? AND status = 'active'`
    ).bind(id).first();
  } catch (e) {
    console.error("[admin/cancel] DB fetch error:", e?.message ?? e);
    return json({ ok: false, error: "A server error occurred. Please try again." }, 500);
  }

  if (!booking) {
    return json({ ok: false, error: "Booking not found or already cancelled" }, 404);
  }

  // ── Cancel ───────────────────────────────────────────────────────────────────
  try {
    await env.DB.prepare(
      `UPDATE bookings SET status = 'cancelled' WHERE id = ?`
    ).bind(id).run();
  } catch (e) {
    console.error("[admin/cancel] DB update error:", e?.message ?? e);
    return json({ ok: false, error: "A server error occurred. Please try again." }, 500);
  }

  // ── Send cancellation email to customer ───────────────────────────────────────
  await sendCancellationEmail({ id, ...booking }, env);

  return json({ ok: true, id });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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

async function sendCancellationEmail(booking, env) {
  if (!env.RESEND_API_KEY || !booking.email) return;

  const fromEmail = env.FROM_EMAIL || "onboarding@resend.dev";
  const dateLabel = formatDate(booking.date);
  const timeLabel = `${formatHour(booking.start_hour)} – ${formatHour(booking.end_hour)}`;

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;background:#09090b;color:#ece9e2;border-radius:16px;overflow:hidden;border:1px solid rgba(199,167,106,.20)">
      <div style="background:linear-gradient(135deg,rgba(248,113,113,.10),rgba(248,113,113,.04));padding:24px 28px;border-bottom:1px solid rgba(248,113,113,.15)">
        <p style="margin:0;font-size:11px;letter-spacing:.25em;text-transform:uppercase;color:#a8894e">Lusso Auto Studio</p>
        <h1 style="margin:8px 0 0;font-size:22px;font-weight:600;color:#f87171">Appointment Cancelled</h1>
      </div>
      <div style="padding:24px 28px">
        <p style="margin:0 0 20px;color:rgba(255,255,255,.70);line-height:1.7">Hi ${booking.name}, your appointment has been cancelled. Here are the details of the cancelled booking:</p>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px 0;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em;width:110px">Date</td><td style="padding:8px 0;font-size:14px;font-weight:600;text-decoration:line-through;color:rgba(255,255,255,.45)">${dateLabel}</td></tr>
          <tr><td style="padding:8px 0;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em">Time</td><td style="padding:8px 0;font-size:14px;text-decoration:line-through;color:rgba(255,255,255,.45)">${timeLabel}</td></tr>
          <tr><td style="padding:8px 0;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em">Service</td><td style="padding:8px 0;font-size:14px;text-decoration:line-through;color:rgba(255,255,255,.45)">${booking.service}</td></tr>
        </table>
        <div style="margin-top:20px;padding:14px 16px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.65);font-size:13px;line-height:1.6">
          If you would like to rebook, please visit <a href="https://lussoautostudio.ca/#book" style="color:#c7a76a">lussoautostudio.ca</a> to select a new time.
        </div>
      </div>
      <div style="padding:16px 28px;border-top:1px solid rgba(255,255,255,.07);font-size:11px;color:rgba(255,255,255,.30)">
        Booking ID: ${booking.id} · Lusso Auto Studio · lussoautostudio.ca
      </div>
    </div>`;

  try {
    await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from:    fromEmail,
        to:      [booking.email],
        subject: `Appointment Cancelled — ${dateLabel}`,
        html,
      }),
    });
  } catch (e) {
    console.error("[admin/cancel] Resend error:", e?.message ?? e);
  }
}

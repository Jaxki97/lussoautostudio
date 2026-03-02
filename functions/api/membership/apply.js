// =============================================================================
// /functions/api/membership/apply.js
// POST /api/membership/apply
//
// Receives a membership application, validates it, saves to D1, sends owner
// notification email via Resend.
//
// Rate limiting: set a Cloudflare WAF rule for this endpoint (3 req/min per IP).
// =============================================================================

const CORS = {
  "access-control-allow-origin":  "https://lussoautostudio.ca",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const VALID_PARKING = [
  "Private driveway",
  "Private garage",
  "Condo / underground",
  "Other",
];

const VALID_START = [
  "Within 7 days",
  "2–3 weeks",
  "Next month",
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

function sanitize(val, max = 500) {
  return typeof val === "string" ? val.trim().slice(0, max) : "";
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  // ── Parse ─────────────────────────────────────────────────────────────────
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "Invalid request body." }, 400); }

  const name            = sanitize(body.name, 120);
  const phone           = sanitize(body.phone, 30);
  const vehicle         = sanitize(body.vehicle, 120);
  const city            = sanitize(body.city, 100);
  const parking         = sanitize(body.parking, 60);
  const preferred_start = sanitize(body.preferred_start, 60);
  const message         = sanitize(body.message, 1000);

  // ── Validate ──────────────────────────────────────────────────────────────
  if (!name)    return json({ ok: false, error: "Name is required." }, 400);
  if (!phone)   return json({ ok: false, error: "Phone is required." }, 400);
  if (!vehicle) return json({ ok: false, error: "Vehicle is required." }, 400);
  if (!city)    return json({ ok: false, error: "City is required." }, 400);

  if (!/^[\d\s\(\)\+\-\.]{7,20}$/.test(phone)) {
    return json({ ok: false, error: "Invalid phone number format." }, 400);
  }
  if (!VALID_PARKING.includes(parking)) {
    return json({ ok: false, error: "Invalid parking selection." }, 400);
  }
  if (!VALID_START.includes(preferred_start)) {
    return json({ ok: false, error: "Invalid preferred start selection." }, 400);
  }

  // ── Save to D1 ────────────────────────────────────────────────────────────
  const id         = crypto.randomUUID();
  const created_at = new Date().toISOString();
  const event_log  = JSON.stringify([{
    event: "application_submitted",
    note:  "Application received from website.",
    at:    created_at,
  }]);

  try {
    await env.DB.prepare(`
      INSERT INTO membership_applications
        (id, name, phone, vehicle, city, parking, preferred_start,
         message, status, event_log, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).bind(id, name, phone, vehicle, city, parking, preferred_start,
            message, event_log, created_at).run();
  } catch (e) {
    console.error("[membership/apply] DB error:", e?.message ?? e);
    return json({ ok: false, error: "A server error occurred. Please try again." }, 500);
  }

  // ── Notify owner via Resend ───────────────────────────────────────────────
  await sendOwnerEmail({ id, name, phone, vehicle, city, parking,
                         preferred_start, message, created_at }, env);

  return json({ ok: true, id }, 201);
}

// ── Email ─────────────────────────────────────────────────────────────────────
async function sendOwnerEmail(app, env) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) return;

  const from = env.FROM_EMAIL || "onboarding@resend.dev";
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:540px;margin:0 auto;background:#09090b;color:#ece9e2;border-radius:16px;overflow:hidden;border:1px solid rgba(199,167,106,.20)">
      <div style="background:linear-gradient(135deg,rgba(199,167,106,.15),rgba(199,167,106,.05));padding:24px 28px;border-bottom:1px solid rgba(199,167,106,.15)">
        <p style="margin:0;font-size:11px;letter-spacing:.25em;text-transform:uppercase;color:#a8894e">Lusso Auto Studio</p>
        <h1 style="margin:8px 0 0;font-size:22px;font-weight:600;color:#c7a76a">New Membership Application</h1>
      </div>
      <div style="padding:24px 28px">
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:7px 0;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em;width:130px">Name</td><td style="padding:7px 0;font-size:14px;font-weight:600">${esc(app.name)}</td></tr>
          <tr><td style="padding:7px 0;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em">Phone</td><td style="padding:7px 0;font-size:14px"><a href="tel:${esc(app.phone)}" style="color:#c7a76a">${esc(app.phone)}</a></td></tr>
          <tr><td style="padding:7px 0;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em">Vehicle</td><td style="padding:7px 0;font-size:14px">${esc(app.vehicle)}</td></tr>
          <tr><td style="padding:7px 0;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em">City</td><td style="padding:7px 0;font-size:14px">${esc(app.city)}</td></tr>
          <tr><td style="padding:7px 0;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em">Parking</td><td style="padding:7px 0;font-size:14px">${esc(app.parking)}</td></tr>
          <tr><td style="padding:7px 0;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em">Start</td><td style="padding:7px 0;font-size:14px">${esc(app.preferred_start)}</td></tr>
          ${app.message ? `<tr style="border-top:1px solid rgba(255,255,255,.07)"><td style="padding:10px 0 7px;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em">Notes</td><td style="padding:10px 0 7px;font-size:13px;color:rgba(255,255,255,.65)">${esc(app.message)}</td></tr>` : ""}
        </table>
      </div>
      <div style="padding:16px 28px;border-top:1px solid rgba(255,255,255,.07);font-size:11px;color:rgba(255,255,255,.30)">
        Application ID: ${app.id} · Review at /admin/membership
      </div>
    </div>`;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to:      [env.NOTIFY_EMAIL],
        subject: `🔖 Membership Application — ${app.name}`,
        html,
      }),
    });
  } catch (e) {
    console.error("[membership/apply] Resend error:", e?.message ?? e);
  }
}

function esc(str) {
  return String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

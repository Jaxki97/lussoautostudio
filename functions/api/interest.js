// =============================================================================
// /functions/api/interest.js
// POST /api/interest
//
// Receives a founding-list interest signup from the landing page, validates it,
// saves to D1 (interest_leads), sends owner notification email via Resend.
//
// Rate limiting: set a Cloudflare WAF rule for this endpoint (3 req/min per IP).
// =============================================================================

const CORS = {
  "access-control-allow-origin":  "https://lussoautostudio.ca",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const VALID_CITY = [
  "Kitchener",
  "Waterloo",
  "Cambridge",
  "Other / nearby",
];

const VALID_INTEREST = [
  "Interior Deep Clean — from $150",
  "Full Detail — from $230",
  "Maintenance Membership — $200/mo",
  "Just curious for now",
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

  // Honeypot: bots fill the hidden "company" field — pretend success, save nothing.
  if (sanitize(body.company, 50)) return json({ ok: true, id: crypto.randomUUID() }, 201);

  const name     = sanitize(body.name, 120);
  const email    = sanitize(body.email, 160).toLowerCase();
  const phone    = sanitize(body.phone, 30);
  const city     = sanitize(body.city, 60);
  const interest = sanitize(body.interest, 80);
  const source   = sanitize(body.source, 300);

  // ── Validate ──────────────────────────────────────────────────────────────
  if (!name)  return json({ ok: false, error: "Name is required." }, 400);
  if (!email) return json({ ok: false, error: "Email is required." }, 400);
  if (!phone) return json({ ok: false, error: "Phone is required." }, 400);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "Invalid email format." }, 400);
  }
  if (!/^[\d\s\(\)\+\-\.]{7,20}$/.test(phone)) {
    return json({ ok: false, error: "Invalid phone number format." }, 400);
  }
  if (!VALID_CITY.includes(city)) {
    return json({ ok: false, error: "Invalid city selection." }, 400);
  }
  if (!VALID_INTEREST.includes(interest)) {
    return json({ ok: false, error: "Invalid interest selection." }, 400);
  }

  // ── Save to D1 ────────────────────────────────────────────────────────────
  const id         = crypto.randomUUID();
  const created_at = new Date().toISOString();

  try {
    await env.DB.prepare(`
      INSERT INTO interest_leads
        (id, name, email, phone, city, interest, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, name, email, phone, city, interest, source, created_at).run();
  } catch (e) {
    console.error("[interest] DB error:", e?.message ?? e);
    return json({ ok: false, error: "A server error occurred. Please try again." }, 500);
  }

  // ── Notify owner via Resend ───────────────────────────────────────────────
  await sendOwnerEmail({ id, name, email, phone, city, interest, source, created_at }, env);

  return json({ ok: true, id }, 201);
}

// ── Email ─────────────────────────────────────────────────────────────────────
async function sendOwnerEmail(lead, env) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) return;

  const from = env.FROM_EMAIL || "onboarding@resend.dev";
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:540px;margin:0 auto;background:#09090b;color:#ece9e2;border-radius:16px;overflow:hidden;border:1px solid rgba(199,167,106,.20)">
      <div style="background:linear-gradient(135deg,rgba(199,167,106,.15),rgba(199,167,106,.05));padding:24px 28px;border-bottom:1px solid rgba(199,167,106,.15)">
        <p style="margin:0;font-size:11px;letter-spacing:.25em;text-transform:uppercase;color:#a8894e">Lusso Auto Studio</p>
        <h1 style="margin:8px 0 0;font-size:22px;font-weight:600;color:#c7a76a">New Founding-List Signup</h1>
      </div>
      <div style="padding:24px 28px">
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:7px 0;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em;width:130px">Name</td><td style="padding:7px 0;font-size:14px;font-weight:600">${esc(lead.name)}</td></tr>
          <tr><td style="padding:7px 0;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em">Email</td><td style="padding:7px 0;font-size:14px"><a href="mailto:${esc(lead.email)}" style="color:#c7a76a">${esc(lead.email)}</a></td></tr>
          ${lead.phone ? `<tr><td style="padding:7px 0;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em">Phone</td><td style="padding:7px 0;font-size:14px"><a href="tel:${esc(lead.phone)}" style="color:#c7a76a">${esc(lead.phone)}</a></td></tr>` : ""}
          <tr><td style="padding:7px 0;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em">City</td><td style="padding:7px 0;font-size:14px">${esc(lead.city)}</td></tr>
          <tr><td style="padding:7px 0;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em">Interest</td><td style="padding:7px 0;font-size:14px;font-weight:600;color:#c7a76a">${esc(lead.interest)}</td></tr>
          <tr style="border-top:1px solid rgba(255,255,255,.07)"><td style="padding:10px 0 7px;font-size:12px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.15em">Source</td><td style="padding:10px 0 7px;font-size:13px;color:rgba(255,255,255,.65)">${esc(lead.source || "direct")}</td></tr>
        </table>
      </div>
      <div style="padding:16px 28px;border-top:1px solid rgba(255,255,255,.07);font-size:11px;color:rgba(255,255,255,.30)">
        Lead ID: ${lead.id} · ${lead.created_at}
      </div>
    </div>`;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to:      [env.NOTIFY_EMAIL],
        subject: `Founding-List Signup — ${lead.name} (${lead.interest})`,
        html,
      }),
    });
  } catch (e) {
    console.error("[interest] Resend error:", e?.message ?? e);
  }
}

function esc(str) {
  return String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

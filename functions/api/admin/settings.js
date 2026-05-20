// =============================================================================
// /functions/api/admin/settings.js  —  Availability settings (admin only)
//
// GET  /api/admin/settings          → { ok, open_hour, close_hour, blocked_dates }
// POST /api/admin/settings          → body: { open_hour?, close_hour?, blocked_dates? }
//                                      → { ok: true }
//
// Requires x-admin-token header matching ADMIN_TOKEN env variable.
// =============================================================================

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function requireAdmin(env, request) {
  const token =
    request.headers.get("x-admin-token") ||
    new URL(request.url).searchParams.get("token") ||
    "";
  return env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
}

async function getSettings(db) {
  const { results } = await db.prepare(
    "SELECT key, value FROM availability_settings"
  ).all();
  const map = Object.fromEntries(results.map(r => [r.key, r.value]));
  return {
    open_hour:     parseInt(map.open_hour     ?? "8",  10),
    close_hour:    parseInt(map.close_hour    ?? "20", 10),
    blocked_dates: JSON.parse(map.blocked_dates ?? "[]"),
  };
}

export async function onRequest({ request, env }) {
  if (!requireAdmin(env, request)) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (request.method === "GET") {
    try {
      const settings = await getSettings(env.DB);
      return json({ ok: true, ...settings });
    } catch (e) {
      console.error("[settings] GET error:", e?.message ?? e);
      return json({ ok: false, error: "Server error" }, 500);
    }
  }

  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const updates = [];

    if (body.open_hour !== undefined) {
      const h = Number(body.open_hour);
      if (!Number.isInteger(h) || h < 0 || h > 23) {
        return json({ ok: false, error: "open_hour must be 0–23" }, 400);
      }
      updates.push(["open_hour", String(h)]);
    }

    if (body.close_hour !== undefined) {
      const h = Number(body.close_hour);
      if (!Number.isInteger(h) || h < 1 || h > 24) {
        return json({ ok: false, error: "close_hour must be 1–24" }, 400);
      }
      updates.push(["close_hour", String(h)]);
    }

    if (body.blocked_dates !== undefined) {
      if (!Array.isArray(body.blocked_dates)) {
        return json({ ok: false, error: "blocked_dates must be an array" }, 400);
      }
      const valid = body.blocked_dates.every(d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d));
      if (!valid) {
        return json({ ok: false, error: "blocked_dates entries must be YYYY-MM-DD strings" }, 400);
      }
      updates.push(["blocked_dates", JSON.stringify(body.blocked_dates)]);
    }

    if (updates.length === 0) {
      return json({ ok: false, error: "No valid fields provided" }, 400);
    }

    try {
      await env.DB.batch(
        updates.map(([k, v]) =>
          env.DB.prepare(
            "INSERT INTO availability_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
          ).bind(k, v)
        )
      );
      return json({ ok: true });
    } catch (e) {
      console.error("[settings] POST error:", e?.message ?? e);
      return json({ ok: false, error: "Server error" }, 500);
    }
  }

  return json({ error: "Method not allowed" }, 405);
}

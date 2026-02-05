function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}

export async function onRequestOptions() {
  return json({ ok: true }, 200);
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();

    const date = String(body.date || "");
    const start_hour = Number(body.start_hour);
    const duration_hours = Number(body.duration_hours);

    const service = String(body.service || "");
    const name = String(body.name || "");
    const phone = String(body.phone || "");
    const vehicle = String(body.vehicle || "");
    const city = String(body.city || "");
    const notes = String(body.notes || "");

    if (!date || !Number.isFinite(start_hour) || !Number.isFinite(duration_hours)) {
      return json({ error: "Missing required fields" }, 400);
    }
    if (duration_hours < 1 || duration_hours > 8) {
      return json({ error: "Invalid duration" }, 400);
    }
    if (start_hour < 0 || start_hour > 23) {
      return json({ error: "Invalid start hour" }, 400);
    }

    const end_hour = start_hour + duration_hours;
    if (end_hour > 24) {
      return json({ error: "Booking exceeds day boundary" }, 400);
    }

    // Only allow weekends
    const d = new Date(`${date}T00:00:00`);
    const day = d.getUTCDay(); // 0 Sun ... 6 Sat
    if (!(day === 0 || day === 6)) {
      return json({ error: "Only weekend bookings are available" }, 400);
    }

    // Check overlap (double-booking protection)
    const overlap = await env.DB.prepare(
      `SELECT COUNT(1) AS c
       FROM bookings
       WHERE date = ?
         AND status = 'active'
         AND NOT (end_hour <= ? OR start_hour >= ?)`
    )
      .bind(date, start_hour, end_hour)
      .first();

    if (overlap?.c > 0) {
      return json({ error: "That time is already booked" }, 409);
    }

    const id = crypto.randomUUID();
    const created_at = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO bookings
        (id, date, start_hour, duration_hours, end_hour, service, name, phone, vehicle, city, notes, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
    )
      .bind(
        id,
        date,
        start_hour,
        duration_hours,
        end_hour,
        service,
        name,
        phone,
        vehicle,
        city,
        notes,
        created_at
      )
      .run();

    return json({ ok: true, id });
  } catch (e) {
    return json({ error: "Server error", details: String(e?.message || e) }, 500);
  }
}

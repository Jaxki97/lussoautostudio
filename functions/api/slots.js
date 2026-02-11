function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const duration_hours = Number(url.searchParams.get("duration_hours"));

  if (!date) return json({ ok: false, error: "Missing date" }, 400);
  if (!Number.isFinite(duration_hours) || duration_hours < 1 || duration_hours > 8) {
    return json({ ok: false, error: "Invalid duration_hours" }, 400);
  }

  // Weekend-only (local date string, but we check day using UTC midnight)
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  if (!(day === 0 || day === 6)) {
    return json({ ok: true, slots: [] }, 200);
  }

  // Pull active bookings for that date
  const { results } = await env.DB.prepare(
    "SELECT start_hour, end_hour FROM bookings WHERE date = ? AND status='active'"
  ).bind(date).all();

  // Helper: check overlap between [aStart,aEnd) and [bStart,bEnd)
  function overlaps(aStart, aEnd, bStart, bEnd) {
    return !(aEnd <= bStart || aStart >= bEnd);
  }

  const OPEN_HOUR = 8;
  const CLOSE_HOUR = 20;

  const slots = [];
  for (let h = OPEN_HOUR; h <= (CLOSE_HOUR - duration_hours); h++) {
    const start = h;
    const end = h + duration_hours;

    let blocked = false;
    for (const row of results) {
      if (overlaps(start, end, row.start_hour, row.end_hour)) {
        blocked = true;
        break;
      }
    }

    slots.push({
      start_hour: h,
      status: blocked ? "booked" : "available"
    });
  }

  return json({ ok: true, slots }, 200);
}

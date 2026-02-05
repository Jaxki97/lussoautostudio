export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");

  if (!date) {
    return new Response(JSON.stringify({ error: "Missing date" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }

  const { results } = await env.DB.prepare(
    "SELECT start_hour, end_hour FROM bookings WHERE date = ? AND status='active'"
  )
    .bind(date)
    .all();

  const booked = [];

  for (const row of results) {
    for (let h = row.start_hour; h < row.end_hour; h++) {
      booked.push(h);
    }
  }

  return new Response(JSON.stringify({ booked }), {
    headers: { "content-type": "application/json" }
  });
}

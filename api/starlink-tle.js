const TLE_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).send("Method Not Allowed");
    return;
  }

  try {
    const upstream = await fetch(TLE_URL, {
      headers: {
        Accept: "text/plain,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 StarlinkOrbitVisualizer/1.0",
      },
      cache: "no-store",
    });

    if (!upstream.ok) {
      response.status(502).send(`CelesTrak returned HTTP ${upstream.status}`);
      return;
    }

    const text = await upstream.text();
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
    response.status(200).send(text);
  } catch (error) {
    response.status(502).send(`Failed to fetch CelesTrak TLE: ${error.message}`);
  }
}

function normalizeBaseUrl(raw: string) {
  const value = raw.trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value.replace(/\/$/, "");
  return `https://${value}`.replace(/\/$/, "");
}

function getBackendBaseUrl() {
  return normalizeBaseUrl(
    process.env.BACKEND_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
  );
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const backendBaseUrl = getBackendBaseUrl();
  if (!backendBaseUrl) {
    return Response.json({ error: "Backend URL is not configured" }, { status: 500 });
  }

  const body = await req.text();
  const upstreamUrl = `${backendBaseUrl}/api/chat`;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": req.headers.get("content-type") || "application/json",
      },
      body,
      cache: "no-store",
    });

    const headers = new Headers();
    headers.set("Cache-Control", "no-cache, no-transform");
    headers.set("Content-Type", upstream.headers.get("content-type") || "text/event-stream; charset=utf-8");

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proxy request failed";
    return Response.json({ error: message }, { status: 502 });
  }
}

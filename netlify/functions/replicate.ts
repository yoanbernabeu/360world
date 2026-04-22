import type { Context } from "@netlify/functions";

const REPLICATE_PREDICTIONS_ENDPOINT =
  "https://api.replicate.com/v1/models/openai/gpt-image-2/predictions";
const REPLICATE_GET_PREDICTION_ENDPOINT = "https://api.replicate.com/v1/predictions";

const CORS_HEADERS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default async (request: Request, _context: Context): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const auth = request.headers.get("authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    return jsonError(401, "Missing or malformed Authorization header.");
  }

  if (request.method === "POST") {
    return handleStart(request, auth);
  }
  if (request.method === "GET") {
    return handlePoll(request, auth);
  }
  return jsonError(405, "Method Not Allowed");
};

async function handleStart(request: Request, auth: string): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Body must be valid JSON.");
  }

  const upstream = await fetch(REPLICATE_PREDICTIONS_ENDPOINT, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return passthrough(upstream);
}

async function handlePoll(request: Request, auth: string): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    return jsonError(400, "Missing or invalid `id` query parameter.");
  }
  const upstream = await fetch(`${REPLICATE_GET_PREDICTION_ENDPOINT}/${id}`, {
    headers: { Authorization: auth },
  });
  return passthrough(upstream);
}

async function passthrough(upstream: Response): Promise<Response> {
  const responseBody = await upstream.text();
  return new Response(responseBody, {
    status: upstream.status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    },
  });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

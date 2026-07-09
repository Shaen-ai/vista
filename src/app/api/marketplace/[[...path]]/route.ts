import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getServerLaravelOrigin } from "@/lib/publicEnv";

export const dynamic = "force-dynamic";

/** Hop-by-hop / unsafe to forward as-is — Node fetch sets Host and Content-Length. */
const SKIP_REQUEST_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authentication",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** Best-effort client IP as seen by this Next.js server (Vercel / nginx / Cloudflare set these). */
function clientIpHint(request: NextRequest): string | null {
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const xReal = request.headers.get("x-real-ip")?.trim();
  if (xReal) return xReal;
  const xff = request.headers.get("x-forwarded-for")?.trim();
  if (xff) return xff.split(",")[0]?.trim() || null;
  return null;
}

function mergeXForwardedFor(request: NextRequest, headers: Headers): void {
  const hint = clientIpHint(request);
  const existing = request.headers.get("x-forwarded-for")?.trim();
  if (hint) {
    if (existing && !existing.split(",").map((s) => s.trim()).includes(hint)) {
      headers.set("x-forwarded-for", `${hint}, ${existing}`);
    } else if (!existing) {
      headers.set("x-forwarded-for", hint);
    } else {
      headers.set("x-forwarded-for", existing);
    }
  } else if (existing) {
    headers.set("x-forwarded-for", existing);
  }

  const proto = request.nextUrl.protocol.replace(":", "");
  if (proto) headers.set("x-forwarded-proto", proto);

  const host = request.headers.get("host");
  if (host) headers.set("x-forwarded-host", host);
}

async function proxyToLaravel(request: NextRequest, pathSegments: string[]): Promise<Response> {
  const subPath = pathSegments.length ? pathSegments.join("/") : "";
  const search = request.nextUrl.search;
  const url = `${getServerLaravelOrigin()}/api/marketplace/${subPath}${search}`;

  const forwardHeaders = new Headers();
  request.headers.forEach((value, key) => {
    if (SKIP_REQUEST_HEADERS.has(key.toLowerCase())) return;
    forwardHeaders.append(key, value);
  });
  mergeXForwardedFor(request, forwardHeaders);

  const init: RequestInit = {
    method: request.method,
    headers: forwardHeaders,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    // @ts-expect-error duplex required when streaming body to fetch in Node
    init.duplex = "half";
  }

  return fetch(url, init);
}

type RouteContext = { params: Promise<{ path?: string[] }> };

async function handle(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { path = [] } = await context.params;
  const upstream = await proxyToLaravel(request, path);
  const out = new Headers(upstream.headers);
  out.delete("transfer-encoding");
  return new NextResponse(upstream.body, { status: upstream.status, headers: out });
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function OPTIONS(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

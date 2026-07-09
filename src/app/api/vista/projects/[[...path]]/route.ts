import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getServerLaravelOrigin } from "@/lib/publicEnv";

export const dynamic = "force-dynamic";

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

async function proxyToLaravel(request: NextRequest, pathSegments: string[]): Promise<Response> {
  const subPath = pathSegments.length ? pathSegments.join("/") : "";
  const search = request.nextUrl.search;
  const url = `${getServerLaravelOrigin()}/api/vista/projects/${subPath}${search}`;

  const forwardHeaders = new Headers();
  request.headers.forEach((value, key) => {
    if (SKIP_REQUEST_HEADERS.has(key.toLowerCase())) return;
    forwardHeaders.append(key, value);
  });

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

export async function PATCH(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

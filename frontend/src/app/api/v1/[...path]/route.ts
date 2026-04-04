/**
 * Catch-all proxy: /api/v1/* → GATEWAY_URL/api/v1/*
 *
 * This runs server-side on every request so it always has access to the
 * GATEWAY_URL runtime environment variable — unlike next.config.js rewrites
 * which are evaluated at build time and may miss runtime-only env vars.
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GATEWAY = (process.env.GATEWAY_URL ?? '').replace(/\/$/, '');

async function proxy(req: NextRequest, { params }: { params: { path: string[] } }) {
  if (!GATEWAY) {
    return NextResponse.json({ error: 'GATEWAY_URL not configured' }, { status: 503 });
  }

  const { path } = params;
  const url = `${GATEWAY}/api/v1/${path.join('/')}${req.nextUrl.search}`;

  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('connection');

  try {
    const res = await fetch(url, {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.blob() : undefined,
      cache: 'no-store',
    });

    const data = res.status !== 204 ? await res.blob() : null;
    const responseHeaders = new Headers(res.headers);
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('transfer-encoding');

    return new NextResponse(data, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error(`Proxy error [${req.method} ${url}]:`, err);
    return NextResponse.json({ error: 'Gateway unreachable' }, { status: 502 });
  }
}

export const GET     = proxy;
export const POST    = proxy;
export const PUT     = proxy;
export const PATCH   = proxy;
export const DELETE  = proxy;
export const OPTIONS = proxy;

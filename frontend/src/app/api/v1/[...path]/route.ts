/**
 * Catch-all proxy: /api/v1/* → GATEWAY_URL/api/v1/*
 *
 * This runs server-side on every request so it always has access to the
 * GATEWAY_URL runtime environment variable — unlike next.config.js rewrites
 * which are evaluated at build time and may miss runtime-only env vars.
 */
import { NextRequest, NextResponse } from 'next/server';

const GATEWAY = (process.env.GATEWAY_URL ?? '').replace(/\/$/, '');

async function proxy(req: NextRequest, { params }: { params: { path: string[] } }) {
  if (!GATEWAY) {
    return NextResponse.json({ error: 'GATEWAY_URL not configured' }, { status: 503 });
  }

  const path = params.path.join('/');
  const search = req.nextUrl.search ?? '';
  const targetUrl = `${GATEWAY}/api/v1/${path}${search}`;

  // Forward all headers except host
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!['host', 'connection', 'transfer-encoding'].includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer();

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      // @ts-expect-error Node 18+ fetch option
      duplex: 'half',
    });

    const resHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
      if (!['transfer-encoding', 'connection'].includes(key.toLowerCase())) {
        resHeaders.set(key, value);
      }
    });

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: resHeaders,
    });
  } catch (err) {
    console.error('[proxy] upstream error:', err);
    return NextResponse.json({ error: 'Gateway unreachable' }, { status: 502 });
  }
}

export const GET     = proxy;
export const POST    = proxy;
export const PUT     = proxy;
export const PATCH   = proxy;
export const DELETE  = proxy;
export const OPTIONS = proxy;

import { NextResponse } from 'next/server';

export async function GET() {
  const gw = process.env.GATEWAY_URL ?? '(not set)';
  // Mask credentials but show the host
  const masked = gw.replace(/:\/\/[^@]*@/, '://***@');
  return NextResponse.json({ gateway: masked });
}

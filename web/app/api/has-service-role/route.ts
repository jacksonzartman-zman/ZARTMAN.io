import { NextResponse } from 'next/server'

export const runtime = 'edge'

export async function GET() {
  try {
    const hasKey = typeof process.env.SUPABASE_SERVICE_ROLE_KEY === 'string' && process.env.SUPABASE_SERVICE_ROLE_KEY.length > 0
    return NextResponse.json({ ok: true, hasServiceRole: hasKey })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 })
  }
}

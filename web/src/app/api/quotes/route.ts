import { NextResponse } from 'next/server'
import { sbService } from '@/lib/supabase'

export async function GET() {
  const sb = sbService()
  if (!sb) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  // TODO: swap auth.uid() with caller identity when you add cookie auth.
  // For MVP, pass ?user=uuid in the URL, or temporarily hardcode your UUID to see real data.
  // Safer: return demo data if no user query provided.
  const url = new URL('http://x'+(Math.random())) // dummy
  const user = (globalThis as any).__NEXT_ON_PAGES_REQUEST__?.url // not available here
  // Simpler: expose ?owner=<uuid>
  return NextResponse.json({ ok: true, note: 'Use /api/quotes?owner=<uuid>' })
}

export async function POST(req: Request) {
  const sb = sbService()
  if (!sb) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  const body = await req.json()
  // body: { owner_user_id, company_id, title }
  const { data, error } = await sb.from('quotes').insert({
    owner_user_id: body.owner_user_id,
    company_id: body.company_id ?? null,
    title: body.title ?? 'Untitled',
    status: 'draft',
    est_total_cents: 0
  }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

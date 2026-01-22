import { NextResponse } from 'next/server'
import { supabasePublic, supabaseAdmin } from '@/lib/supabase.server'

// GET /api/quotes?owner=<uuid>
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const owner = searchParams.get('owner')
    if (!owner) return NextResponse.json({ error: 'owner required' }, { status: 400 })

    const sb = supabasePublic()
    const { data, error } = await sb
      .from('quotes')
      .select('id,title,company_id,owner_user_id,status,created_at')
      .eq('owner_user_id', owner)
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json({ quotes: data ?? [] })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/quotes  body: { title: string, company_id?: uuid, owner_user_id: uuid }
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const sb = supabaseAdmin() // allow creating rows regardless of RLS draft state
    const { data, error } = await sb
      .from('quotes')
      .insert({
        title: body.title ?? 'Untitled Quote',
        company_id: body.company_id ?? null,
        owner_user_id: body.owner_user_id,
        status: 'draft',
      })
      .select('id,title,company_id,owner_user_id,status,created_at')
      .single()
    if (error) throw error
    return NextResponse.json({ quote: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

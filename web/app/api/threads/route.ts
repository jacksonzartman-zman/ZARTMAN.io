import { NextResponse } from 'next/server'
import { sbService } from '@/lib/supabase'

export async function POST(req: Request) {
  const sb = sbService()
  if (!sb) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  const { quote_id } = await req.json()
  const { data, error } = await sb.from('threads')
    .insert({ quote_id })
    .select('id,quote_id,created_at').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase.server'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('files')
      .insert({
        quote_id: body.quote_id ?? null,
        filename: body.filename,
        size_bytes: body.size_bytes ?? null,
        mime: body.mime ?? null,
      })
      .select('*')
      .single()
    if (error) throw error
    return NextResponse.json({ file: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

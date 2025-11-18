import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseserver'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    if (!body?.filename) {
      return NextResponse.json({ error: 'filename required' }, { status: 400 })
    }

    const admin = supabaseAdmin()
    const insertPayload: Record<string, any> = {
      quote_id: body.quote_id ?? null,
      filename: body.filename,
      size_bytes: body.size_bytes ?? null,
      mime: body.mime ?? null,
    }

    if (body.owner_user_id) insertPayload.owner_user_id = body.owner_user_id
    if (body.storage_path) insertPayload.storage_path = body.storage_path
    if (body.bucket_id) insertPayload.bucket_id = body.bucket_id

    const { data, error } = await admin.from('files').insert(insertPayload).select('*').single()
    if (error) throw error
    return NextResponse.json({ file: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

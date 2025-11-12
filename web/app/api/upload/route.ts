import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

export async function POST(req: Request) {
  try {
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { ok: false, error: 'Missing SUPABASE env variables on server' },
        { status: 500 }
      )
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ ok: false, error: 'No file provided' }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const uint8 = new Uint8Array(arrayBuffer)

    const key = `${Date.now()}_${file.name.replace(/\s+/g, '_')}`

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      // in Edge runtimes we must forward the global fetch implementation
      global: { fetch },
    })

    const { error: uploadError } = await supabase.storage
      .from('cad')
      .upload(key, uint8, { contentType: file.type })

    if (uploadError) {
      return NextResponse.json({ ok: false, error: uploadError.message }, { status: 500 })
    }

    const publicUrl = `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/cad/${encodeURIComponent(
      key
    )}`

    return NextResponse.json({ ok: true, key, publicUrl })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 })
  }
}

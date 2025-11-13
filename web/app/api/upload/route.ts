import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

export async function POST(req: Request) {
  try {
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      const body = JSON.stringify({ ok: false, error: 'Missing SUPABASE env variables on server', missing: {
        NEXT_PUBLIC_SUPABASE_URL: !!SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_SERVICE_ROLE_KEY,
      } })
      return new Response(body, { status: 500, headers: { 'content-type': 'application/json' } })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      const body = JSON.stringify({ ok: false, error: 'No file provided' })
      return new Response(body, { status: 400, headers: { 'content-type': 'application/json' } })
    }

    const key = `${Date.now()}_${file.name.replace(/\s+/g, '_')}`

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      // in Edge runtimes we must forward the global fetch implementation
      global: { fetch },
    })

    const contentType = file.type && file.type.trim() !== '' ? file.type : 'application/octet-stream'
    const { error: uploadError } = await supabase.storage
      .from('cad')
      .upload(key, file, { contentType, upsert: false })

    if (uploadError) {
      const body = JSON.stringify({ ok: false, error: uploadError.message, details: uploadError })
      return new Response(body, {
        status: 500,
        headers: { 'content-type': 'application/json', 'x-served-by': 'next-app-edge' },
      })
    }

    const publicUrl = `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/cad/${encodeURIComponent(
      key
    )}`

    const body = JSON.stringify({ ok: true, key, publicUrl })
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-served-by': 'next-app-edge' },
    })
  } catch (err: any) {
    const body = JSON.stringify({ ok: false, error: err?.message ?? String(err) })
    return new Response(body, {
      status: 500,
      headers: { 'content-type': 'application/json', 'x-served-by': 'next-app-edge' },
    })
  }
}

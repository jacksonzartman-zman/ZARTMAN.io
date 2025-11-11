import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase.server'
import { randomUUID } from 'crypto'

export const runtime = 'edge'

export async function POST(req: Request) {
  try {
    const { owner_user_id, quote_id, filename } = await req.json()

    if (!owner_user_id || !filename) {
      return NextResponse.json({ error: 'owner_user_id and filename required' }, { status: 400 })
    }

    const key = `${owner_user_id}/${quote_id ?? 'unassigned'}/${randomUUID()}-${filename}`

    const admin = supabaseAdmin()
    const { data, error } = await admin.storage.from('cad').createSignedUploadUrl(key)

    if (error) throw error
    // data = { signedUrl, token, path }
    return NextResponse.json({ path: key, signedUrl: (data as any).signedUrl, token: (data as any).token })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

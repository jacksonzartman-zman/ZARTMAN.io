import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase.server'
import { randomUUID } from 'crypto'

/**
 * POST /api/upload
 * body: { owner_user_id: uuid, quote_id?: uuid, filename: string }
 * returns: { url: string, path: string }
 */
export async function POST(req: Request) {
  try {
    const { owner_user_id, quote_id, filename } = await req.json()
    if (!owner_user_id || !filename) {
      return NextResponse.json({ error: 'owner_user_id and filename required' }, { status: 400 })
    }

    const key = `${owner_user_id}/${quote_id ?? 'unassigned'}/${randomUUID()}-${filename}`
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .storage.from('cad')
      .createSignedUploadUrl(key) // enables direct browser upload
    if (error) throw error

    return NextResponse.json({ url: (data as any).signedUrl, path: key })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

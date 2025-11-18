import { NextResponse } from 'next/server'
import { supabasePublic, supabaseAdmin } from '@/lib/supabaseServer'

// GET /api/messages?quote=<uuid>
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const quote = searchParams.get('quote')
    if (!quote) return NextResponse.json({ error: 'quote required' }, { status: 400 })

    const sb = supabasePublic()
    const { data, error } = await sb
      .from('messages')
      .select('*')
      .eq('thread_id', (await getThreadId(sb, quote)))
      .order('created_at', { ascending: true })

    if (error) throw error
    return NextResponse.json({ messages: data ?? [] })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/messages  body: { quote_id: uuid, sender_user_id: uuid, body: string }
export async function POST(req: Request) {
  try {
    const { quote_id, sender_user_id, body } = await req.json()
    if (!quote_id || !sender_user_id || !body) {
      return NextResponse.json({ error: 'quote_id, sender_user_id, body required' }, { status: 400 })
    }
    const admin = supabaseAdmin()
    const threadId = await getOrCreateThreadId(admin, quote_id)

    const { data, error } = await admin
      .from('messages')
      .insert({ thread_id: threadId, sender_user_id, body, is_read: false })
      .select('*')
      .single()

    if (error) throw error
    return NextResponse.json({ message: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

async function getThreadId(sb: ReturnType<typeof supabasePublic>, quoteId: string) {
  const { data, error } = await sb.from('threads').select('id').eq('quote_id', quoteId).maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

async function getOrCreateThreadId(sb: ReturnType<typeof supabaseAdmin>, quoteId: string) {
  const { data: existing, error: e1 } = await sb.from('threads').select('id').eq('quote_id', quoteId).maybeSingle()
  if (e1) throw e1
  if (existing?.id) return existing.id
  const { data: created, error: e2 } = await sb.from('threads').insert({ quote_id: quoteId }).select('id').single()
  if (e2) throw e2
  return created.id
}

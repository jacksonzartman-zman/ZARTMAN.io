import { NextResponse } from 'next/server'
import { sbService } from '@/lib/supabase'

export async function GET(req: Request) {
  const sb = sbService()
  if (!sb) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  const { searchParams } = new URL(req.url)
  const quoteId = searchParams.get('quote')
  const threadId = searchParams.get('thread')

  if (!quoteId && !threadId) {
    return NextResponse.json({ error: 'Provide ?quote=<uuid> or ?thread=<uuid>' }, { status: 400 })
  }

  // join via threads → quotes
  let query = sb.from('messages')
    .select('id, body, is_read, created_at, thread_id, threads!inner( id, quote_id ), threads:threads!inner( quotes!inner( owner_user_id ) )')
    .order('created_at', { ascending: false })
    .limit(50)

  if (threadId) query = query.eq('thread_id', threadId)
  if (quoteId)  query = query.eq('threads.quote_id', quoteId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const sb = sbService()
  if (!sb) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  const { thread_id, sender_user_id, body } = await req.json()
  const { data, error } = await sb.from('messages')
    .insert({ thread_id, sender_user_id, body, is_read: false })
    .select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

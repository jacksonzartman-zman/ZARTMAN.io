import { NextResponse } from 'next/server'
import { supabaseSrv } from '@/lib/supabase.server'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const quote = searchParams.get('quote')

    if (!quote) {
      return NextResponse.json({ error: 'Missing quote param' }, { status: 400 })
    }

    // messages join threads so we fetch by thread.quote_id
    const { data, error } = await supabaseSrv
      .from('messages')
      .select('id, thread_id, sender_user_id, body, created_at, is_read, threads!inner(quote_id)')
      .eq('threads.quote_id', quote)
      .order('created_at', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data ?? [])
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const { thread_id, sender_user_id, body: text } = body
    const { data, error } = await supabaseSrv
      .from('messages')
      .insert({ thread_id, sender_user_id, body: text, is_read: false })
      .select('*')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Server error' }, { status: 500 })
  }
}

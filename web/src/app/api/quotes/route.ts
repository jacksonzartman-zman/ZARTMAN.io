import { NextResponse } from 'next/server'
import { supabaseSrv } from '@/lib/supabase.server'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const owner = searchParams.get('owner')

    if (!owner) {
      return NextResponse.json({ error: 'Missing owner param' }, { status: 400 })
    }

    const { data, error } = await supabaseSrv
      .from('quotes')
      .select('id,title,status,est_total_cents,created_at,company_id,owner_user_id')
      .eq('owner_user_id', owner)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data ?? [])
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Server error' }, { status: 500 })
  }
}

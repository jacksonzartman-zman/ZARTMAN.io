import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

async function sbFromEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const h = await headers();
  const auth = h.get('Authorization') ?? h.get('authorization') ?? '';
  return createClient(url, key, { global: { headers: { Authorization: auth } } });
}

export async function GET() {
  const supabase = await sbFromEnv();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('quotes')
    .select('*')
    .eq('owner_user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ quotes: data });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const title = (body.title ?? 'Untitled') as string;
  const supabase = await sbFromEnv();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const payload = { title, owner_user_id: user.id, status: 'draft', company_id: null, est_total_cents: 0 };
  const { data, error } = await supabase.from('quotes').insert(payload).select('*').single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ quote: data });
}

import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || null
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'present' : 'missing'
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'present' : 'missing'

  let bucketProbe: any = null
  let bucketError: string | null = null
  if (url && service === 'present') {
    try {
      const client = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { global: { fetch } })
      const { data, error } = await client.storage.from('cad').list('', { limit: 1 })
      if (error) bucketError = error.message
      else bucketProbe = { sample: data?.[0] || null, count: data?.length ?? 0 }
    } catch (e: any) {
      bucketError = e?.message || String(e)
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      env: { url: !!url, anon, service },
      bucket: bucketProbe,
      bucketError,
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-served-by': 'next-app-edge',
      },
    }
  )
}

export const runtime = 'edge'

export async function GET() {
  try {
    const hasKey = typeof process.env.SUPABASE_SERVICE_ROLE_KEY === 'string' && process.env.SUPABASE_SERVICE_ROLE_KEY.length > 0
    const body = JSON.stringify({ ok: true, hasServiceRole: hasKey })
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-served-by': 'next-app-edge' },
    })
  } catch (err: any) {
    const body = JSON.stringify({ ok: false, error: err?.message ?? String(err) })
    return new Response(body, {
      status: 500,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-served-by': 'next-app-edge' },
    })
  }
}

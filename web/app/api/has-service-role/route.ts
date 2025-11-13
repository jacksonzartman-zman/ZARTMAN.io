export const runtime = 'edge'

export async function GET() {
  try {
    const hasKey = typeof process.env.SUPABASE_SERVICE_ROLE_KEY === 'string' && process.env.SUPABASE_SERVICE_ROLE_KEY.length > 0
    return new Response(
      JSON.stringify({ ok: true, hasServiceRole: hasKey }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'x-served-by': 'next-app-edge',
        },
      }
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message ?? String(err) }),
      {
        status: 500,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'x-served-by': 'next-app-edge',
        },
      }
    )
  }
}

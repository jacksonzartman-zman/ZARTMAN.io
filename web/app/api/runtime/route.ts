export const runtime = 'edge'

export async function GET() {
  const hasServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY
  return new Response(
    JSON.stringify({ ok: true, runtime: 'edge', hasServiceRole }),
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

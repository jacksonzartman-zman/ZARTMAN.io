export const runtime = 'edge'

export async function GET() {
  const hasServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY
  const body = JSON.stringify({ ok: true, runtime: 'edge', hasServiceRole })
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
}

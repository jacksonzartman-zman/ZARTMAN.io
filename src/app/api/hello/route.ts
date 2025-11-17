export const runtime = 'edge'

export async function GET() {
  return new Response('ok', { headers: { 'content-type': 'text/plain' } })
}

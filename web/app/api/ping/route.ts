export const runtime = 'edge'

export async function GET() {
  return new Response('pong:GET', { status: 200 })
}

export async function POST() {
  return new Response('pong:POST', { status: 200 })
}

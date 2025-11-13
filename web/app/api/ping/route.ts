// web/app/api/ping/route.ts
export const runtime = 'edge';

const HEADERS = {
	'content-type': 'text/plain; charset=utf-8',
	'cache-control': 'no-store',
	'x-served-by': 'next-app-edge',
} as const

export async function GET() {
	return new Response('pong:GET', { headers: HEADERS })
}

export async function POST() {
	return new Response('pong:POST', { headers: HEADERS })
}

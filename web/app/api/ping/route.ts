// web/app/api/ping/route.ts
export const runtime = 'edge';

export async function GET() {
	return new Response('pong:GET', {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'no-store',
			'x-served-by': 'next-app-edge',
		},
	})
}

export async function POST() {
	return new Response('pong:POST', {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'no-store',
			'x-served-by': 'next-app-edge',
		},
	})
}

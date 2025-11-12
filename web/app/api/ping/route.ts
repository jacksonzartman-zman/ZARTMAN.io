// web/app/api/ping/route.ts
export const runtime = 'edge';

export async function GET() { return new Response('pong:GET'); }
export async function POST() { return new Response('pong:POST'); }

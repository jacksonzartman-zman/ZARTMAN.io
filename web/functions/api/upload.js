// Removed: This file was a Cloudflare Pages Function that caused Pages to upload
// a root `functions/` directory. The handler has been intentionally cleared so
// the repository no longer exposes a live Pages Function. Commit & push this
// change to remove the function from published deploys.

export const onRequestPost = async () => {
  return new Response(JSON.stringify({ ok: false, message: 'Deprecated endpoint. Use Next.js /api/upload instead.' }), {
    status: 404,
    headers: { 'cache-control': 'no-store', 'content-type': 'application/json' },
  });
};

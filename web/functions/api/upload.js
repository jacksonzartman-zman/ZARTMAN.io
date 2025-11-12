// Removed: This file was a Cloudflare Pages Function that caused Pages to upload
// a root `functions/` directory. The handler has been intentionally cleared so
// the repository no longer exposes a live Pages Function. Commit & push this
// change to remove the function from published deploys.

export const onRequestPost = async () => {
  return new Response(JSON.stringify({ ok: false, message: 'This function has been removed. Use /api/upload (app route) instead.' }), {
    status: 410,
    headers: { 'content-type': 'application/json' },
  });
};

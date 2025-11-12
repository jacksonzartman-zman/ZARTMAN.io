/**
 * Cloudflare Pages Function: POST /api/upload
 * Accepts multipart/form-data { file: <File> } and uploads to Supabase Storage bucket "cad".
 */

export const onRequestPost = async ({ request, env }) => {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing file' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const projectUrl = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
    const bucket = 'cad';
    const safeName = (file.name || 'upload.bin').replace(/\s+/g, '-');
    const key = `${Date.now()}-${safeName}`;

    const uploadUrl = `${projectUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`;

    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'x-upsert': 'false',
        'content-type': file.type || 'application/octet-stream',
      },
      // In the Pages/Workers runtime the File exposes a stream() method
      body: file.stream(),
    });

    if (!res.ok) {
      const txt = await res.text();
      return new Response(JSON.stringify({ ok: false, error: txt || res.statusText }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    const publicUrl = `${projectUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`;

    return new Response(JSON.stringify({ ok: true, key, publicUrl }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};

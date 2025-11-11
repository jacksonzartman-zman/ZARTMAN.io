"use client";
import { useState } from 'react';

// Uses the signed-upload flow: POST /api/upload -> PUT signed URL -> (optional) record via /api/files
export default function CadUpload() {
  const [msg, setMsg] = useState<string>('');

  async function handleUpload(file: File) {
    try {
      setMsg('Preparing upload...')
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: JSON.stringify({ owner_user_id: 'me', filename: file.name }),
        headers: { 'Content-Type': 'application/json' },
      })
      const body = await res.json()
      if (body.error) throw new Error(body.error)

      const { url, path } = body
      setMsg('Uploading file...')
      const put = await fetch(url, { method: 'PUT', body: file })
      if (!put.ok) throw new Error('Upload failed')

      // Try to record the file row (best-effort). If your backend exposes /api/files it will persist.
      try {
        await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quote_id: null, filename: file.name, size_bytes: file.size, mime: file.type || 'application/octet-stream', path }),
        })
      } catch (e) {
        // ignore
      }

      setMsg('Upload complete ✅')
    } catch (e: any) {
      setMsg(`Upload error: ${e?.message ?? String(e)}`)
    }
  }

  return (
    <div className="space-y-2">
      <label className="px-3 py-2 rounded bg-white text-black cursor-pointer">
        <input
          type="file"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f) }}
        />
        Upload CAD
      </label>
      {msg && <div className="text-sm opacity-70">{msg}</div>}
    </div>
  );
}

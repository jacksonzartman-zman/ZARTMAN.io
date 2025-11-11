
'use client'
import { supabaseBrowser } from '@/lib/supabase.client'

export async function handleCadUpload(file: File, ownerUserId: string, quoteId?: string) {
  // Step 1: ask our API for a signed upload URL + token
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner_user_id: ownerUserId,
      quote_id: quoteId ?? null,
      filename: file.name,
    }),
  })

  const { error, path, token } = await res.json()
  if (!res.ok || error) throw new Error(error || 'Could not get signed upload URL')

  // Step 2: upload file to Supabase using the token
  const sb = supabaseBrowser()
  const { data, error: upErr } = await sb.storage
    .from('cad')
    .uploadToSignedUrl(path, token, file, {
      upsert: true,
      contentType: file.type || 'application/octet-stream',
    } as any)

  if (upErr) throw upErr

  // Optional: record the file row in your DB (keeps list in `files` table)
  await fetch('/api/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quote_id: quoteId ?? null,
      filename: file.name,
      size_bytes: file.size,
      mime: file.type || 'application/octet-stream',
    }),
  })

  return data
}

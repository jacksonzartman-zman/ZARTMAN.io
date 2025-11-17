
"use client"
import { supabaseBrowser } from '@/lib/supabase.client'

function apiBase() {
  // Next.js replaces process.env.NEXT_PUBLIC_* at build time for client code.
  // If not set, fall back to relative paths (empty string) so fetch('/api/...') still works.
  const base = (process.env.NEXT_PUBLIC_API_BASE as string) || ''
  // strip trailing slash
  return base.replace(/\/$/, '')
}

export async function handleCadUpload(file: File, ownerUserId: string, quoteId?: string) {
  // Step 1: ask our API for a signed upload URL + token
  const res = await fetch(`${apiBase()}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner_user_id: ownerUserId,
      quote_id: quoteId ?? null,
      filename: file.name,
    }),
  })

  const uploadMeta = await res.json().catch(() => ({}))
  const { error, path, token } = uploadMeta as { error?: string; path?: string; token?: string }
  if (!res.ok || error || !path || !token) {
    throw new Error(error || 'Could not get signed upload URL')
  }

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
  const recordRes = await fetch(`${apiBase()}/api/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quote_id: quoteId ?? null,
      filename: file.name,
      size_bytes: file.size,
      mime: file.type || 'application/octet-stream',
      owner_user_id: ownerUserId,
      storage_path: path,
    }),
  })

  if (!recordRes.ok) {
    const recordPayload = await recordRes.json().catch(() => ({}))
    throw new Error(
      (recordPayload as { error?: string }).error || 'Could not record uploaded file metadata'
    )
  }

  return data
}

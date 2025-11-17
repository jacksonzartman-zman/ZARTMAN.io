import { NextRequest, NextResponse } from 'next/server'

import { supabaseServer } from '@/lib/supabaseServer'

const BUCKET_ID = 'cad-uploads'

export const runtime = 'nodejs'

function normalizeFileName(name?: string | null) {
  if (!name) return 'upload.bin'
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
}

export async function POST(req: NextRequest) {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid multipart/form-data payload'
    return NextResponse.json({ error: message }, { status: 400 })
  }

    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Expected a file field named "file"' }, { status: 400 })
    }

    try {
      const bytes = await file.arrayBuffer()
      const fileName = normalizeFileName(file.name)
      const objectPath = `uploads/${Date.now()}-${fileName}`
      const contentType = file.type || 'application/octet-stream'
      const fileSize = typeof file.size === 'number' ? file.size : bytes.byteLength

      const { error } = await supabaseServer.storage.from(BUCKET_ID).upload(objectPath, bytes, {
        contentType,
        upsert: false,
      })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const {
        data: { publicUrl },
      } = supabaseServer.storage.from(BUCKET_ID).getPublicUrl(objectPath)

      if (!publicUrl) {
        return NextResponse.json({ error: 'Unable to retrieve uploaded file URL' }, { status: 500 })
      }

      const { data: uploadRow, error: insertError } = await supabaseServer
        .from('uploads')
        .insert({
          file_path: objectPath,
          file_name: fileName,
          file_size: fileSize,
          content_type: contentType,
        })
        .select()
        .single()

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 })
      }

      return NextResponse.json({ url: publicUrl, upload: uploadRow ?? null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

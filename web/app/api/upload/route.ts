import { createClient } from '@supabase/supabase-js'

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
}

const BUCKET_ID = 'cad'

export const runtime = 'edge'
export const preferredRegion = 'auto'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

type UploadError = {
  ok: false
  step:
    | 'parse-form'
    | 'env-check'
    | 'read-file'
    | 'supabase-upload'
    | 'unexpected'
  error: string
  details?: Record<string, unknown>
}

export async function POST(req: Request) {
  try {
    let formData: FormData
    try {
      formData = await req.formData()
    } catch (err: any) {
      return jsonResponse(
        {
          ok: false,
          step: 'parse-form',
          error: 'Request body must be multipart/form-data',
          details: { message: err?.message ?? String(err) },
        } satisfies UploadError,
        400
      )
    }

    const fileField = formData.get('file')
    if (!(fileField instanceof File)) {
      return jsonResponse(
        {
          ok: false,
          step: 'parse-form',
          error: 'No file received under field "file"',
          details: { receivedType: typeof fileField },
        } satisfies UploadError,
        400
      )
    }

    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse(
        {
          ok: false,
          step: 'env-check',
          error: 'Missing Supabase server environment variables',
          details: {
            NEXT_PUBLIC_SUPABASE_URL: !!SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_SERVICE_ROLE_KEY,
          },
        } satisfies UploadError,
        500
      )
    }

    let fileBuffer: Uint8Array
    try {
      const arrayBuffer = await fileField.arrayBuffer()
      fileBuffer = new Uint8Array(arrayBuffer)
    } catch (err: any) {
      return jsonResponse(
        {
          ok: false,
          step: 'read-file',
          error: 'Failed to read uploaded file payload',
          details: { message: err?.message ?? String(err) },
        } satisfies UploadError,
        422
      )
    }

    const sanitizedName = fileField.name?.replace(/\s+/g, '_') || 'unnamed'
    const objectKey = `${Date.now()}_${sanitizedName}`
    const contentType =
      typeof fileField.type === 'string' && fileField.type.trim() !== ''
        ? fileField.type
        : 'application/octet-stream'

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { fetch },
    })

    const { data, error } = await supabase.storage.from(BUCKET_ID).upload(objectKey, fileBuffer, {
      contentType,
      cacheControl: '3600',
      upsert: false,
    })

    if (error) {
      return jsonResponse(
        {
          ok: false,
          step: 'supabase-upload',
          error: error.message,
          details: { name: (error as { name?: string })?.name, statusCode: (error as { statusCode?: number })?.statusCode },
        } satisfies UploadError,
        502
      )
    }

    const publicUrl = supabase.storage.from(BUCKET_ID).getPublicUrl(objectKey).data.publicUrl ?? null

    return jsonResponse({
      ok: true,
      key: objectKey,
      publicUrl,
      bucket: BUCKET_ID,
      size: fileBuffer.byteLength,
      contentType,
      data,
    })
  } catch (err: any) {
    return jsonResponse(
      {
        ok: false,
        step: 'unexpected',
        error: err?.message ?? String(err),
      } satisfies UploadError,
      500
    )
  }
}

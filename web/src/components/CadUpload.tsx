"use client"

import { useState, type ChangeEvent } from "react"
import { supabaseBrowser } from "@/lib/supabase.client"

export default function CadUpload() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setBusy(true)
    setMessage(null)

    try {
      const supabase = supabaseBrowser()

      // Optional: ensure we have a session (anonymous) so RLS that depends on auth.uid() passes
      // If you don't have auth turned on, skip this block.
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) {
        await supabase.auth.signInAnonymously()
      }

      // folder: user-id or "guest"
      const { data: user } = await supabase.auth.getUser()
      const userId = user.user?.id ?? "guest"

      // Path in the cad bucket
      const path = `${userId}/${Date.now()}_${file.name}`

      console.log("[UPLOAD] starting", { bucket: "cad", path, type: file.type, size: file.size })

      const { data, error } = await supabase
        .storage
        .from("cad")
        .upload(path, file, { upsert: true, contentType: file.type || "application/octet-stream" })

      if (error) {
        console.error("[UPLOAD] error", error)
        setMessage(`Upload failed: ${error.message}`)
      } else {
        console.log("[UPLOAD] success", data)
        setMessage("Upload complete ✅ — check the cad bucket.")
      }
    } catch (err: any) {
      console.error("[UPLOAD] exception", err)
      setMessage(`Upload crashed: ${err?.message || String(err)}`)
    } finally {
      setBusy(false)
      // reset input so you can re-select the same file if needed
      e.currentTarget.value = ""
    }
  }

  return (
    <div>
      <label className="inline-flex items-center gap-3 cursor-pointer">
        <input
          type="file"
          accept=".step,.stp,.stl,.igs,.iges,.sldprt,.x_t,.x_b,.3mf,.obj"
          onChange={onPick}
          disabled={busy}
          className="hidden"
        />
        <span className="rounded-full px-4 py-2 bg-emerald-600 text-white">
          {busy ? "Uploading…" : "Upload your CAD"}
        </span>
      </label>
      {message && <p className="mt-2 text-sm opacity-80">{message}</p>}
    </div>
  )
}

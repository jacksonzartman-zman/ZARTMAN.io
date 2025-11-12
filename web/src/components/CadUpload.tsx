"use client";
import { useRef, useState } from "react";

export default function CadUpload() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [log, setLog] = useState<string>("");

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setLog(`Picked: ${f.name} (${f.type || "unknown"}) • ${f.size} bytes\nUploading…`);

    const fd = new FormData();
    fd.append("file", f);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      setLog((prev) => prev + `\nResponse: ${res.status} ${res.statusText}\n${JSON.stringify(json, null, 2)}`);

      // If upload succeeded, record metadata in /api/files for tracking
      if (res.ok && json?.ok) {
        const metadata = {
          filename: f.name,
          size_bytes: f.size,
          mime: f.type || null,
          storage_path: json.key || null,
        }

        try {
          const r2 = await fetch('/api/files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(metadata),
          })
          const j2 = await r2.json()
          setLog((prev) => prev + `\nFiles API: ${r2.status} ${r2.statusText}\n${JSON.stringify(j2, null, 2)}`)
        } catch (err: any) {
          setLog((prev) => prev + `\n❌ Failed to record metadata: ${err?.message ?? err}`)
        }
      }
    } catch (err: any) {
      setLog((prev) => prev + `\n❌ Network error: ${err?.message ?? err}`);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
      <input
        ref={inputRef}
        type="file"
        accept=".step,.stp,.iges,.igs,.stl,.obj,.zip"
        onChange={onPick}
        style={{ position: "absolute", opacity: 0, width: 1, height: 1 }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        style={{ padding: "10px 16px", borderRadius: 999, background: "#1db954", fontWeight: 600 }}
        aria-label="Upload your CAD"
      >
        Upload your CAD
      </button>
      {log && (
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#0f1115", padding: 10, borderRadius: 8 }}>
          {log}
        </pre>
      )}
    </div>
  );
}

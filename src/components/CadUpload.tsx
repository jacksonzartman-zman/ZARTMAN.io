"use client";
import { useRef, useState } from "react";
import { CAD_ACCEPT_STRING } from "@/lib/cadFileTypes";

export default function CadUpload() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [log, setLog] = useState<string>("Select a CAD file to begin.");

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setLog(
      [
        `Picked: ${f.name} (${f.type || "unknown"}) • ${f.size.toLocaleString()} bytes`,
        "📤 Uploading…",
      ].join("\n"),
    );

    const fd = new FormData();
    fd.append("file", f);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const text = await res.text();
      let json: any;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }

      if (res.ok && json?.ok) {
        const successLines = [
          `✅ Upload complete: ${f.name}`,
          `Storage key: ${json.key}`,
          json.publicUrl ? `Public URL: ${json.publicUrl}` : "Public URL: (not public)",
        ];
        setLog(successLines.join("\n"));

        // If upload succeeded, record metadata in /api/files for tracking
        const metadata = {
          filename: f.name,
          size_bytes: f.size,
          mime: f.type || null,
          storage_path: json.key || null,
        };

        try {
          const recordRes = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(metadata),
          });
          if (!recordRes.ok) {
            const recordJson = await recordRes.json().catch(() => ({}));
            setLog((prev) =>
              [
                prev,
                `⚠️ Metadata save failed: ${recordJson?.error ?? `${recordRes.status} ${recordRes.statusText}`}`,
              ].join("\n"),
            );
          }
        } catch (err: any) {
          setLog((prev) => [
            prev,
            `⚠️ Metadata save error: ${err?.message ?? String(err)}`,
          ].join("\n"));
        }
      } else {
        const step = json?.step ?? "unknown";
        const errMsg = json?.error ?? `Request failed with ${res.status} ${res.statusText}`;
        const diagnostic = json ? `Diagnostics: ${JSON.stringify(json, null, 2)}` : undefined;
        setLog(
          [
            `❌ Upload failed at step "${step}".`,
            `Reason: ${errMsg}`,
            diagnostic,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
    } catch (err: any) {
      setLog(`❌ Network error: ${err?.message ?? String(err)}`);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
        <input
          ref={inputRef}
          type="file"
          // Same literal accept list keeps STL/STEP/etc. selectable in iOS Safari pickers.
          accept={CAD_ACCEPT_STRING}
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
        <pre
          aria-live="polite"
          style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#0f1115", padding: 10, borderRadius: 8 }}
        >
          {log}
        </pre>
    </div>
  );
}

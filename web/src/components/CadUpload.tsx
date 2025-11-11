"use client";
import { useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function CadUpload() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string>("");

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("Uploading…");

    const key = `${Date.now()}-${file.name}`;
    const { data, error } = await supabase.storage
      .from("cad")
      .upload(key, file, { cacheControl: "3600", upsert: false });

    if (error) {
      console.error("upload error", error);
      setStatus(`❌ ${error.message}`);
      return;
    }

    const pub = supabase.storage.from("cad").getPublicUrl(key).data.publicUrl;
    console.log("uploaded", data, pub);
    setStatus(`✅ Uploaded: ${key}`);
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Hide input but keep it in DOM for iPad Safari */}
      <input
        ref={inputRef}
        type="file"
        accept=".step,.stp,.iges,.igs,.stl"
        onChange={onChange}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-label="Upload your CAD"
        style={{
          padding: "10px 16px",
          borderRadius: 999,
          background: "#1db954",
          color: "black",
          fontWeight: 600,
        }}
      >
        Upload your CAD
      </button>
      {status && <div>{status}</div>}
    </div>
  );
}

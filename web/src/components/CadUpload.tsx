"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function CadUpload() {
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    console.log("CadUpload: file input change fired");
    setMsg(null);

    const file = e.target.files?.[0];
    if (!file) {
      setMsg("No file selected");
      return;
    }

    setUploading(true);
    const path = `${Date.now()}-${file.name}`;

    const { data, error } = await supabase.storage
      .from("cad")
      .upload(path, file, { cacheControl: "3600", upsert: false });

    if (error) {
      console.error("CadUpload: upload error", error);
      setMsg(`Upload failed: ${error.message}`);
    } else {
      console.log("CadUpload: upload success", data);
      const { data: pub } = supabase.storage.from("cad").getPublicUrl(path);
      setMsg(`✅ Uploaded: ${pub.publicUrl}`);
    }
    setUploading(false);
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <input
        type="file"
        accept=".step,.stp,.iges,.igs,.stl"
        onChange={handleFileChange}
      />
      {uploading && <span>Uploading…</span>}
      {msg && <span>{msg}</span>}
    </div>
  );
}

"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase.client";

export default function CadUpload() {
  const [status, setStatus] = useState<string>("");

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    setStatus("Uploading…");
    const supa = supabaseBrowser();
    const path = `uploads/${Date.now()}_${f.name}`;

    // Make sure your bucket is named "cad"
    const { data, error } = await supa.storage
      .from("cad")
      .upload(path, f, { upsert: false, contentType: f.type || "application/octet-stream" });

    if (error) {
      console.error("Upload failed:", error);
      setStatus(`Upload failed: ${error.message}`);
      return;
    }
    console.log("Uploaded:", data);
    setStatus("Uploaded!");
  }

  return (
    <div>
      <input
        type="file"
        accept=".step,.stp,.igs,.iges,.stl,.zip,.pdf,.sldprt,.prt,.3mf,.obj"
        onChange={onPick}
      />
      {status && <p className="text-sm mt-2 opacity-80">{status}</p>}
    </div>
  );
}

"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function CadUpload() {
  const [uploading, setUploading] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    console.log("File input event fired"); // <-- Required to debug on iPad

    const file = e.target.files?.[0];
    if (!file) {
      console.log("No file selected");
      return;
    }

    setUploading(true);

    const filePath = `${Date.now()}-${file.name}`;

    const { data, error } = await supabase.storage
      .from("cad")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      console.error("Upload error:", error);
      alert(`Upload failed: ${error.message}`);
    } else {
      console.log("Upload success:", data);
      alert("✅ Upload complete!");

      // OPTIONAL: Log public URL
      const { data: publicUrl } = supabase.storage.from("cad").getPublicUrl(filePath);

      console.log("Public URL:", publicUrl.publicUrl);
    }

    setUploading(false);
  }

  return (
    <div>
      <input
        type="file"
        accept=".step,.stp,.iges,.igs,.stl"
        onChange={handleFileChange}
        style={{ display: "block", marginBottom: "12px" }}
      />
      {uploading && <p>Uploading…</p>}
    </div>
  );
}

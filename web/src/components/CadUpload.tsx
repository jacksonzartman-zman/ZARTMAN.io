"use client";
import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase.client";
import { handleCadUpload } from "@/lib/upload.client";

const supabase = supabaseBrowser();

export default function CadUpload() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getUser().then((res) => {
      if (!isMounted) return;
      setUser(res.data.user ?? null);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => setUser(session?.user ?? null),
    );

    return () => {
      isMounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!user?.id) {
      setStatus("Please sign in before uploading.");
      e.target.value = "";
      return;
    }

    setUploading(true);
    setStatus("Uploading…");

    try {
      await handleCadUpload(file, user.id);
      setStatus(`✅ Uploaded: ${file.name}`);
    } catch (err: any) {
      console.error("upload error", err);
      setStatus(`❌ ${err?.message ?? "Upload failed"}`);
    } finally {
      setUploading(false);
      if (e.target) e.target.value = "";
    }
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
        disabled={uploading}
        style={{
          padding: "10px 16px",
          borderRadius: 999,
          background: uploading ? "#999" : "#1db954",
          color: "black",
          fontWeight: 600,
          cursor: uploading ? "not-allowed" : "pointer",
          opacity: uploading ? 0.7 : 1,
        }}
      >
        {uploading ? "Uploading…" : "Upload your CAD"}
      </button>
      {!user && (
        <div style={{ fontSize: 14, opacity: 0.7 }}>
          Sign in to upload CAD files.
        </div>
      )}
      {status && <div>{status}</div>}
    </div>
  );
}

"use client";
import { useState } from 'react';
import { handleCadUpload } from '@/lib/upload.client';

export default function CadUpload() {
  const [msg, setMsg] = useState<string>('');
  const OWNER = '<TEMP_USER_UUID>' // replace with real user id when auth is added

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setMsg('Uploading...')
      await handleCadUpload(file, OWNER)
      setMsg('Upload complete ✅')
    } catch (err: any) {
      console.error(err)
      setMsg(`Upload failed: ${err?.message ?? String(err)}`)
    }
  }

  return (
    <div className="space-y-2">
      <label className="px-3 py-2 rounded bg-white text-black cursor-pointer">
        <input type="file" accept=".step,.stp,.stl,.iges,.igs,.sldprt,.x_t,.x_b,.3mf,.obj" className="hidden" onChange={onPick} />
        Upload CAD
      </label>
      {msg && <div className="text-sm opacity-70">{msg}</div>}
    </div>
  );
}

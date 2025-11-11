"use client";
import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function CadUpload() {
  const [msg, setMsg] = useState<string>('');

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return setMsg('Please sign in.');

    const path = `${user.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from('cad').upload(path, file, { upsert: false });
    if (error) setMsg(`Upload failed: ${error.message}`);
    else setMsg('Upload ok ✅');
  }

  return (
    <div className="space-y-2">
      <label className="px-3 py-2 rounded bg-white text-black cursor-pointer">
        <input type="file" className="hidden" onChange={onPick} />
        Upload CAD
      </label>
      {msg && <div className="text-sm opacity-70">{msg}</div>}
    </div>
  );
}

"use client";
import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { setUser((data as any).user ?? null); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange(() =>
      supabase.auth.getUser().then(({ data }) => setUser((data as any).user ?? null))
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return null;

  if (!user) return <LoginForm />;

  return <>{children}</>;
}

function LoginForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
    setSent(true);
  }

  return (
    <form onSubmit={sendLink} className="p-6 rounded-lg bg-neutral-900 border border-neutral-800 space-y-3">
      <div className="text-xl font-semibold">Sign in</div>
      <input
        className="w-full px-3 py-2 rounded bg-neutral-800 border border-neutral-700"
        placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)}
      />
      <button className="px-3 py-2 rounded bg-white text-black">Send magic link</button>
      {sent && <p className="text-sm opacity-70">Check your email for the link.</p>}
    </form>
  );
}

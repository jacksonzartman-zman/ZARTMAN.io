"use client"
import { useState } from 'react'
import { sbBrowser } from '@/lib/supabase'

export default function AuthPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  async function send() {
    const supabase = sbBrowser()
    if (!supabase) return alert('Supabase not configured')
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "http://localhost:3000";
    const nextPath =
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search ?? ""}`
        : "/";
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
      },
    })
    if (!error) setSent(true)
    else alert(error.message)
  }

  return (
    <main className="mx-auto w-full max-w-sm px-4 py-14 sm:py-16">
      <div className="space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Sign in
          </h1>
          <p className="text-sm text-ink-muted">
            We’ll email you a magic link.
          </p>
        </header>
      {sent ? (
        <p className="text-sm text-ink-soft">Check your inbox.</p>
      ) : (
        <>
          <div className="space-y-3">
            <label className="grid gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-ink-muted">
                Email
              </span>
              <input
                placeholder="you@company.com"
                value={email}
                onChange={(e)=>setEmail(e.target.value)}
                className="h-11 w-full rounded-xl border border-line-subtle bg-page-soft px-3 text-sm text-ink outline-none placeholder:text-ink-muted/70 focus:border-white/20 focus:ring-2 focus:ring-white/10"
              />
            </label>
            <button
              onClick={send}
              className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-black shadow-sm transition hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-60"
            >
              Send link
            </button>
          </div>
        </>
      )}
      </div>
    </main>
  )
}

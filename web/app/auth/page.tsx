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
    <main style={{ padding: 32, maxWidth: 420 }}>
      <h1>Sign in</h1>
      <p>We’ll email you a magic link.</p>
      {sent ? (
        <p>Check your inbox.</p>
      ) : (
        <>
          <input
            placeholder="you@company.com"
            value={email}
            onChange={(e)=>setEmail(e.target.value)}
            style={{ width:'100%', padding:12, borderRadius:8, margin:'12px 0' }}
          />
          <button onClick={send} style={{ padding:12, borderRadius:8 }}>Send link</button>
        </>
      )}
    </main>
  )
}

"use client"
import { useState } from 'react'
import { sbBrowser } from '@/lib/supabase'

export default function AuthPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  async function send() {
    const supabase = sbBrowser()
    if (!supabase) return alert('Supabase not configured')
    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000")
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${baseUrl}/auth/callback`,
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

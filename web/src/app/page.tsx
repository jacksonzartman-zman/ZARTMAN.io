"use client"
import { useEffect, useState } from 'react'
import AuthGate from '@/components/AuthGate'

type Quote = { id:string; title:string; est_total_cents:number; created_at:string }
type Msg = { id:string; body:string; created_at:string; thread_id:string }

export default function Home() {
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [messages, setMessages] = useState<Msg[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      setLoading(true)
      // TODO: swap hardcoded owner for the signed-in user later
      const owner = 'YOUR-USER-UUID-HERE'
      const q = await fetch(`/api/quotes?owner=${owner}`).then(r=>r.json()).catch(()=>null)
      // Add a simple demo until the quotes endpoint returns real rows
      if (!q || !q.length) {
        setQuotes([
          { id:'demo1', title:'Impeller Housing', est_total_cents:142000, created_at:new Date().toISOString() },
          { id:'demo2', title:'QA & Post-Processing', est_total_cents:32000, created_at:new Date().toISOString() },
        ])
      } else {
        setQuotes(q)
      }
      // For messages, if you have a thread_id, fetch by thread:
      const m = await fetch(`/api/messages?quote=${'DEMO-QUOTE-ID-OR-REMOVE'}`).then(r=>r.json()).catch(()=>null)
      setMessages(Array.isArray(m) ? m : [])
      setLoading(false)
    })()
  }, [])

  return (
    <main className="p-6 md:p-10 text-white">
      <AuthGate>
      <section className="max-w-3xl">
        <p className="text-sm uppercase opacity-70">Manufacturing OS</p>
        <h1 className="mt-2 text-5xl font-extrabold">Zartman.io powers the modern manufacturing platform.</h1>
        <p className="mt-4 opacity-80">
          Centralize quoting, collaboration, and supplier orchestration. Upload secure CAD files, align teams instantly, and deliver precision parts without the back-and-forth.
        </p>
      </section>

      <div className="grid md:grid-cols-2 gap-6 mt-10">
        {/* Inbox */}
        <div className="rounded-2xl bg-neutral-900/60 border border-white/10 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Inbox</h3>
            <span className="text-xs bg-emerald-500/15 text-emerald-300 px-2 py-0.5 rounded">Live</span>
          </div>
          {loading && <p className="opacity-70">Loading…</p>}
          {!loading && messages.length === 0 && (
            <div className="opacity-60 text-sm">No messages yet.</div>
          )}
          <ul className="space-y-3">
            {messages.slice(0,4).map(m => (
              <li key={m.id} className="rounded-lg bg-neutral-800/60 border border-white/10 p-3">
                <p className="text-sm">{m.body}</p>
                <p className="text-xs opacity-60 mt-1">{new Date(m.created_at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </div>

        {/* Quote builder (list of quotes for now) */}
        <div className="rounded-2xl bg-neutral-900/60 border border-white/10 p-4">
          <h3 className="font-semibold mb-3">Quote Builder</h3>
          <ul className="space-y-3">
            {quotes.map(q => (
              <li key={q.id} className="flex items-center justify-between rounded-lg bg-neutral-800/60 border border-white/10 p-3">
                <div>
                  <div className="font-medium">{q.title}</div>
                  <div className="text-xs opacity-60">{new Date(q.created_at).toLocaleDateString()}</div>
                </div>
                <div className="font-semibold">${(q.est_total_cents/100).toLocaleString()}</div>
              </li>
            ))}
          </ul>
          <button
            className="mt-4 w-full rounded-lg bg-white/10 hover:bg-white/20 transition p-2"
            onClick={async ()=>{
              const owner_user_id = 'YOUR-USER-UUID-HERE'
              const res = await fetch('/api/quotes', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ owner_user_id, title:'New Quote' })
              }).then(r=>r.json())
              if (res?.id) location.reload()
              else alert(res?.error || 'Failed')
            }}
          >
            + New Quote
          </button>
        </div>
      </div>
      </AuthGate>
    </main>
  )
}
 

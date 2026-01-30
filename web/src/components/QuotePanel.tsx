"use client";
import { useEffect, useState } from 'react';

type Quote = { id: string; title: string; status: string; created_at: string };

export default function QuotePanel() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [busy, setBusy] = useState(false);
  const OWNER = '<TEMP_USER_UUID>' // replace with real user id when auth is added

  async function load() {
    const r = await fetch(`/api/quotes?owner=${OWNER}`, { cache: 'no-store' });
    if (r.ok) {
      const { quotes } = await r.json();
      setQuotes(quotes ?? []);
    }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setBusy(true);
    await fetch('/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'New Quote', owner_user_id: OWNER }) });
    setBusy(false);
    load();
  }

  return (
    <div className="space-y-4">
      <button
        onClick={create}
        disabled={busy}
        className="inline-flex h-10 items-center justify-center rounded-pill bg-white px-4 text-sm font-semibold text-black shadow-sm transition hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-60"
      >
        {busy ? 'Creating…' : '+ New Quote'}
      </button>
      <div className="space-y-2">
        {quotes.map(q => (
          <div
            key={q.id}
            className="rounded-2xl border border-line-subtle bg-page-soft/80 p-4 shadow-lift-sm"
          >
            <div className="text-sm font-semibold text-ink tracking-tight">{q.title}</div>
            <div className="mt-1 text-xs text-ink-muted">
              {q.status} • {new Date(q.created_at).toLocaleString()}
            </div>
          </div>
        ))}
        {quotes.length === 0 && <div className="text-sm text-ink-muted">No quotes yet.</div>}
      </div>
    </div>
  );
}

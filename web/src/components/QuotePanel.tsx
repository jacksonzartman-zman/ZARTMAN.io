"use client";
import { useEffect, useState } from 'react';

type Quote = { id: string; title: string; status: string; created_at: string };

export default function QuotePanel() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch('/api/quotes', { cache: 'no-store' });
    if (r.ok) {
      const { quotes } = await r.json();
      setQuotes(quotes);
    }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setBusy(true);
    await fetch('/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'New Quote' }) });
    setBusy(false);
    load();
  }

  return (
    <div className="space-y-3">
      <button onClick={create} disabled={busy} className="px-3 py-2 rounded bg-white text-black">
        {busy ? 'Creating…' : '+ New Quote'}
      </button>
      <div className="space-y-2">
        {quotes.map(q => (
          <div key={q.id} className="p-3 rounded bg-neutral-900 border border-neutral-800">
            <div className="font-medium">{q.title}</div>
            <div className="text-sm opacity-70">{q.status} • {new Date(q.created_at).toLocaleString()}</div>
          </div>
        ))}
        {quotes.length === 0 && <div className="opacity-60">No quotes yet.</div>}
      </div>
    </div>
  );
}

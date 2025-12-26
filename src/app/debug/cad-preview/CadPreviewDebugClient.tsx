"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";

export function CadPreviewDebugClient({
  initialBucket,
  initialPath,
  initialKind,
}: {
  initialBucket: string;
  initialPath: string;
  initialKind: string;
}) {
  const [bucket, setBucket] = useState(initialBucket);
  const [path, setPath] = useState(initialPath);
  const [kind, setKind] = useState(initialKind);
  const [result, setResult] = useState<string>("idle");
  const [pending, setPending] = useState(false);

  const url = useMemo(() => {
    if (!bucket.trim() || !path.trim()) return null;
    const qs = new URLSearchParams();
    qs.set("bucket", bucket.trim());
    qs.set("path", path.trim());
    qs.set("disposition", "inline");
    if (kind.trim()) qs.set("kind", kind.trim());
    return `/api/cad-preview?${qs.toString()}`;
  }, [bucket, path, kind]);

  const run = async () => {
    if (!url) return;
    setPending(true);
    setResult("loading...");
    try {
      const res = await fetch(url, { method: "GET" });
      const contentType = res.headers.get("content-type");
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setResult(
          JSON.stringify(
            { ok: false, status: res.status, contentType, body: json },
            null,
            2,
          ),
        );
        return;
      }
      const buf = await res.arrayBuffer();
      setResult(
        JSON.stringify(
          {
            ok: true,
            status: res.status,
            contentType,
            bytes: buf.byteLength,
          },
          null,
          2,
        ),
      );
    } catch (e) {
      setResult(JSON.stringify({ ok: false, error: String(e) }, null, 2));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="p-6 text-slate-200">
      <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-slate-400">bucket</label>
            <input
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-800 bg-black/30 px-3 py-2 text-xs text-slate-100"
              placeholder="cad"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-slate-400">path</label>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-800 bg-black/30 px-3 py-2 text-xs text-slate-100"
              placeholder="uploads/quotes/<quoteId>/<file>.step"
            />
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-slate-400">kind (optional)</label>
            <input
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-800 bg-black/30 px-3 py-2 text-xs text-slate-100"
              placeholder="step|stl|obj|glb"
            />
          </div>
          <div className="md:col-span-2 flex items-end gap-2">
            <button
              type="button"
              onClick={run}
              disabled={!url || pending}
              className={clsx(
                "rounded-full border border-slate-700 bg-slate-900/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:border-slate-600",
                (!url || pending) && "opacity-60",
              )}
            >
              {pending ? "Loading…" : "Fetch preview"}
            </button>
            {url ? (
              <a
                href={url}
                className="text-xs text-slate-300 underline underline-offset-4"
              >
                Open raw
              </a>
            ) : null}
          </div>
        </div>
        {url ? (
          <div className="mt-3">
            <span className="text-slate-400">url:</span>{" "}
            <span className="text-slate-100">{url}</span>
          </div>
        ) : null}
      </div>

      <pre className="whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-100">
        {result}
      </pre>
    </div>
  );
}


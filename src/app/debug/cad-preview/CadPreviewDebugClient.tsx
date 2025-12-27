"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";

export function CadPreviewDebugClient({
  initialKind,
  initialToken,
}: {
  initialKind: string;
  initialToken: string;
}) {
  const [token, setToken] = useState(initialToken);
  const [kind, setKind] = useState(initialKind);
  const [result, setResult] = useState<string>("idle");
  const [pending, setPending] = useState(false);
  const [downloadBlobUrl, setDownloadBlobUrl] = useState<string | null>(null);

  const url = useMemo(() => {
    if (!token.trim()) return null;
    const qs = new URLSearchParams();
    if (kind.trim()) qs.set("kind", kind.trim());
    qs.set("token", token.trim());
    qs.set("disposition", "inline");
    return `/api/cad-preview?${qs.toString()}`;
  }, [token, kind]);

  useEffect(() => {
    return () => {
      if (downloadBlobUrl) URL.revokeObjectURL(downloadBlobUrl);
    };
  }, [downloadBlobUrl]);

  const run = async () => {
    if (!url) return;
    setPending(true);
    setResult("loading...");
    try {
      if (downloadBlobUrl) {
        URL.revokeObjectURL(downloadBlobUrl);
        setDownloadBlobUrl(null);
      }

      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: { "cache-control": "no-cache" },
      });

      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });

      const errorText = !res.ok ? await res.clone().text().catch(() => "") : null;
      const buf = await res.arrayBuffer().catch(() => new ArrayBuffer(0));

      const blobUrl = URL.createObjectURL(
        new Blob([buf], { type: res.headers.get("content-type") ?? "application/octet-stream" }),
      );
      setDownloadBlobUrl(blobUrl);

      setResult(
        JSON.stringify(
          {
            ok: res.ok,
            status: res.status,
            headers,
            bytes: buf.byteLength,
            errorText: errorText || null,
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
          <div className="md:col-span-2">
            <label className="text-slate-400">token</label>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-800 bg-black/30 px-3 py-2 text-xs text-slate-100"
              placeholder="<preview token>"
            />
          </div>
          <div>
            <label className="text-slate-400">kind</label>
            <input
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-800 bg-black/30 px-3 py-2 text-xs text-slate-100"
              placeholder="step|stl|obj|glb"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
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
              Open raw (re-fetch)
            </a>
          ) : null}
          {downloadBlobUrl ? (
            <a
              href={downloadBlobUrl}
              download="cad-preview-response"
              className="text-xs text-slate-300 underline underline-offset-4"
            >
              Download raw response
            </a>
          ) : null}
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


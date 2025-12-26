"use client";

import { useEffect, useMemo, useState } from "react";
import { ThreeCadViewer, type ViewerStatus } from "@/components/ThreeCadViewer";

type PageProps = {
  searchParams?: Promise<{
    fileId?: string;
    fileName?: string;
  }>;
};

export default function StepViewerDebugPage({ searchParams }: PageProps) {
  const [fileId, setFileId] = useState<string>("");
  const [fileName, setFileName] = useState<string>("debug.step");

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(searchParams)
      .then((sp) => {
        if (cancelled) return;
        const nextFileId = typeof sp?.fileId === "string" ? sp.fileId : "";
        const nextFileName =
          typeof sp?.fileName === "string" && sp.fileName.trim() ? sp.fileName.trim() : "debug.step";
        setFileId(nextFileId);
        setFileName(nextFileName);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[step-debug-page] searchParams resolve failed", err);
      });

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  const url = useMemo(() => {
    return fileId
      ? `/api/parts-file-preview?fileId=${encodeURIComponent(fileId)}&disposition=inline&fileName=${encodeURIComponent(
          fileName,
        )}&previewAs=stl_preview`
      : null;
  }, [fileId, fileName]);

  const [status, setStatus] = useState<ViewerStatus>("idle");
  const [errorReason, setErrorReason] = useState<string | null>(null);

  useEffect(() => {
    console.log("[step-debug-page] mounted", { fileId, fileName, url });
  }, [fileId, fileName, url]);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(url, { method: "GET" });
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        console.log("[step-debug-page] fetched bytes", {
          ok: res.ok,
          status: res.status,
          size: buf.byteLength,
        });
      } catch (err) {
        if (cancelled) return;
        console.error("[step-debug-page] fetch failed", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!fileId) {
    return (
      <div className="p-6 text-slate-200">
        <p className="text-sm font-semibold">STEP debug</p>
        <p className="mt-2 text-sm text-slate-300">
          Pass <code className="text-slate-100">?fileId=&lt;quote_upload_file_id&gt;&amp;fileName=&lt;optional&gt;</code>{" "}
          in the URL. Use a STEP file.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 text-slate-200">
      <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs">
        <div>
          <span className="text-slate-400">fileId:</span> <span className="text-slate-100">{fileId}</span>
        </div>
        <div className="mt-1">
          <span className="text-slate-400">fileName:</span>{" "}
          <span className="text-slate-100">{fileName}</span>
        </div>
        <div className="mt-1">
          <span className="text-slate-400">url:</span> <span className="text-slate-100">{url}</span>
        </div>
      </div>

      {url ? (
        <ThreeCadViewer
          fileName={fileName}
          url={url}
          cadKind="step"
          onStatusChange={(report) => {
            setStatus(report.status);
            setErrorReason(report.errorReason ?? null);
          }}
        />
      ) : null}

      <pre className="mt-4 whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-100">
        Status: {status}
        {"\n"}
        Reason: {errorReason ?? "none"}
      </pre>
    </div>
  );
}


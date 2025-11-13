"use client";

import { useState } from "react";

type UploadState =
  | { kind: "idle"; message: string }
  | { kind: "uploading"; filename: string; size: number }
  | { kind: "success"; filename: string; key: string; publicUrl: string | null }
  | { kind: "error"; step: string; error: string; raw?: Record<string, unknown> };

export default function CadUpload() {
  const [state, setState] = useState<UploadState>({
    kind: "idle",
    message: "Choose a CAD file (STEP, IGES, STL, OBJ, ZIP).",
  });

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    setState({ kind: "uploading", filename: file.name, size: file.size });

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const text = await response.text();
      let payload: any;
      try {
        payload = text ? JSON.parse(text) : undefined;
      } catch {
        payload = undefined;
      }

      if (response.ok && payload?.ok) {
        setState({
          kind: "success",
          filename: file.name,
          key: payload.key ?? "(missing)",
          publicUrl: payload.publicUrl ?? null,
        });
      } else {
        setState({
          kind: "error",
          step: payload?.step ?? "unknown",
          error: payload?.error ?? `${response.status} ${response.statusText}`,
          raw: payload,
        });
      }
    } catch (error: any) {
      setState({
        kind: "error",
        step: "network",
        error: error?.message ?? String(error),
      });
    } finally {
      event.currentTarget.value = "";
    }
  }

  return (
    <section
      aria-label="CAD upload"
      style={{
        display: "grid",
        gap: "1rem",
        padding: "1.5rem",
        borderRadius: "1rem",
        border: "1px solid #2a2d34",
        background: "rgba(15, 17, 21, 0.85)",
        maxWidth: "520px",
      }}
    >
      <header>
        <h2 style={{ margin: 0, fontSize: "1.75rem" }}>Upload a CAD file</h2>
        <p style={{ margin: "0.25rem 0 0", color: "#a0a3ad" }}>
          Files stay private by default. We support STEP, IGES, STL, OBJ, and ZIP archives.
        </p>
      </header>

      <input
        type="file"
        name="file"
        accept=".step,.stp,.iges,.igs,.stl,.obj,.zip"
        onChange={handleChange}
        style={{
          padding: "0.85rem",
          borderRadius: "0.75rem",
          border: "1px solid #3d414c",
          background: "#0f1115",
          color: "#f7f8f9",
          fontSize: "1rem",
        }}
      />

      <StatusDisplay state={state} />
    </section>
  );
}

function StatusDisplay({ state }: { state: UploadState }) {
  switch (state.kind) {
    case "idle":
      return (
        <p style={{ margin: 0, color: "#a0a3ad" }} aria-live="polite">
          {state.message}
        </p>
      );
    case "uploading":
      return (
        <p style={{ margin: 0, color: "#a0a3ad" }} aria-live="assertive">
          Uploading <strong>{state.filename}</strong> (
          {new Intl.NumberFormat().format(state.size)} bytes)…
        </p>
      );
    case "success":
      return (
        <div
          aria-live="assertive"
          style={{
            display: "grid",
            gap: "0.35rem",
            padding: "0.85rem",
            borderRadius: "0.75rem",
            background: "rgba(46, 204, 113, 0.18)",
            color: "#2ecc71",
          }}
        >
          <strong>Upload complete</strong>
          <span>File: {state.filename}</span>
          <span>Key: {state.key}</span>
          <span>
            Public URL:{" "}
            {state.publicUrl ? (
              <a
                href={state.publicUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#b7f7d1", wordBreak: "break-all" }}
              >
                {state.publicUrl}
              </a>
            ) : (
              "not public"
            )}
          </span>
        </div>
      );
    case "error":
      return (
        <div
          aria-live="assertive"
          style={{
            display: "grid",
            gap: "0.35rem",
            padding: "0.85rem",
            borderRadius: "0.75rem",
            background: "rgba(242, 101, 91, 0.18)",
            color: "#f2655b",
          }}
        >
          <strong>Upload failed at step: {state.step}</strong>
          <span>{state.error}</span>
          {state.raw ? (
            <code style={{ whiteSpace: "pre-wrap", fontSize: "0.8rem", color: "#ffd7d4" }}>
              {JSON.stringify(state.raw, null, 2)}
            </code>
          ) : null}
        </div>
      );
    default:
      return null;
  }
}

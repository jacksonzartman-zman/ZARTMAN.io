"use client";

import React from "react";

type ErrorBoundaryProps = {
  children: React.ReactNode;
  title?: string | null;
};

type ErrorBoundaryState = {
  error: Error | null;
  componentStack: string | null;
};

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const componentStack =
      typeof info?.componentStack === "string" ? info.componentStack : "";

    console.error("[ui-error-boundary]", {
      message: error?.message ?? "",
      stack: error?.stack ?? null,
      componentStack: componentStack || null,
    });

    this.setState({ error, componentStack: componentStack || null });
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    const title =
      typeof this.props.title === "string" && this.props.title.trim()
        ? this.props.title.trim()
        : "Something went wrong";

    return (
      <div className="rounded-3xl border border-red-500/40 bg-red-500/10 p-6 text-left shadow-[0_10px_30px_rgba(2,6,23,0.45)]">
        <div className="text-sm font-semibold text-red-100">{title}</div>
        <div className="mt-3 space-y-3 text-xs text-red-100/90">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-red-100/70">
              error.message
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-words rounded-md border border-white/10 bg-black/30 p-3 text-[11px] text-red-100">
              {this.state.error.message || "(no message)"}
            </pre>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-red-100/70">
              componentStack
            </div>
            <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-white/10 bg-black/30 p-3 text-[11px] text-red-100">
              {this.state.componentStack || "(no component stack)"}
            </pre>
          </div>
        </div>
      </div>
    );
  }
}


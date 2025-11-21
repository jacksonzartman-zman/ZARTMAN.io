"use client";

import React, {
  useState,
  DragEvent,
  ChangeEvent,
  FormEvent,
  useEffect,
} from "react";
import clsx from "clsx";
import {
  CAD_ACCEPT_STRING,
  CAD_FILE_TYPE_DESCRIPTION,
  MAX_UPLOAD_SIZE_BYTES,
  bytesToMegabytes,
  isAllowedCadFileName,
} from "@/lib/cadFileTypes";

/**
 * Minimal, easily testable iOS/iPadOS detector. Modern iPadOS (13+) reports
 * itself as "Macintosh" but still includes the "Mobile" token in the UA.
 */
const isIOSUserAgent = (userAgent: string): boolean => {
  if (!userAgent) return false;
  if (/(ipad|iphone|ipod)/i.test(userAgent)) return true;
  return /macintosh/i.test(userAgent) && /mobile/i.test(userAgent);
};

type UploadState = {
  file: File | null;
  fileName: string | null;
  name: string;
  email: string;
  company: string;
  notes: string;
};

const initialState: UploadState = {
  file: null,
  fileName: null,
  name: "",
  email: "",
  company: "",
  notes: "",
};

const MAX_UPLOAD_SIZE_LABEL = `${bytesToMegabytes(MAX_UPLOAD_SIZE_BYTES)} MB`;
const FILE_TYPE_ERROR_MESSAGE = `Unsupported file type. Please upload ${CAD_FILE_TYPE_DESCRIPTION}.`;

type UploadFileDescriptor = {
  bucket: string;
  storageKey: string;
  storagePath: string;
  sizeBytes: number;
  mimeType: string;
  originalFileName: string;
  sanitizedFileName: string;
  extension?: string | null;
};

type UploadSuccessResponse = {
  success: true;
  message?: string;
  uploadId?: string;
  quoteId?: string | null;
  file?: UploadFileDescriptor;
  metadataRecorded?: boolean;
  step?: string;
};

type UploadErrorResponse = {
  success: false;
  message?: string;
  step?: string;
};

type UploadApiResponse = UploadSuccessResponse | UploadErrorResponse;

const extractPayloadMessage = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") return null;
  const recordPayload = payload as Record<string, unknown>;

  if (typeof recordPayload.message === "string") {
    const message = recordPayload.message.trim();
    if (message) {
      return message;
    }
  }

  if (typeof recordPayload.error === "string") {
    const errorMsg = recordPayload.error.trim();
    if (errorMsg) {
      return errorMsg;
    }
  }

  if (
    recordPayload.details &&
    typeof recordPayload.details === "object" &&
    "message" in (recordPayload.details as Record<string, unknown>) &&
    typeof (recordPayload.details as { message?: unknown }).message === "string"
  ) {
    const detailsMessage = (
      recordPayload.details as { message: string }
    ).message.trim();
    if (detailsMessage) {
      return detailsMessage;
    }
  }

  return null;
};

const isUploadApiResponse = (
  payload: unknown,
): payload is UploadApiResponse => {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      "success" in payload &&
      typeof (payload as { success?: unknown }).success === "boolean",
  );
};

const formatReadableBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 MB";
  }
  return `${bytesToMegabytes(bytes)} MB`;
};

const validateCadFile = (file: File): string | null => {
  if (!isAllowedCadFileName(file.name)) {
    return FILE_TYPE_ERROR_MESSAGE;
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return `File is ${formatReadableBytes(file.size)}. Limit is ${MAX_UPLOAD_SIZE_LABEL}.`;
  }

  if (file.size === 0) {
    return "File is empty. Please choose a different CAD file.";
  }

  return null;
};

export default function UploadBox() {
  const [state, setState] = useState<UploadState>(initialState);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isIOSDevice, setIsIOSDevice] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setIsIOSDevice(isIOSUserAgent(navigator.userAgent));
  }, []);

  const canSubmit = !!(state.file && state.name && state.email);
  const fileInputAccept = isIOSDevice ? undefined : CAD_ACCEPT_STRING;

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const validationError = validateCadFile(file);
    if (validationError) {
      setError(validationError);
      setStatusMessage(null);
      setSuccess(false);
      setSuccessMessage(null);
      setState((prev) => ({ ...prev, file: null, fileName: null }));
      return;
    }

    setError(null);
    setSuccess(false);
    setSuccessMessage(null);
    setStatusMessage(null);
    setState((prev) => ({ ...prev, file, fileName: file.name }));
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;

    const validationError = validateCadFile(file);
    if (validationError) {
      setError(validationError);
      setStatusMessage(null);
      setSuccess(false);
      setSuccessMessage(null);
      setState((prev) => ({ ...prev, file: null, fileName: null }));
      // Clear so they can re-choose
      e.target.value = "";
      return;
    }

    setError(null);
    setSuccess(false);
    setSuccessMessage(null);
    setStatusMessage(null);
    setState((prev) => ({ ...prev, file, fileName: file.name }));
  };

  const handleChange =
    (field: keyof UploadState) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = e.target.value;
      setState((prev) => ({ ...prev, [field]: value }));
    };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSuccessMessage(null);
    setStatusMessage("Validating file…");

    if (!state.file) {
      setStatusMessage(null);
      setError("Please select a CAD file to upload.");
      return;
    }

    const fileValidationError = validateCadFile(state.file);
    if (fileValidationError) {
      setStatusMessage(null);
      setError(fileValidationError);
      return;
    }

    if (!state.name || !state.email) {
      setStatusMessage(null);
      setError("Please add at least your name and email.");
      return;
    }

    setSubmitting(true);
    setStatusMessage("Uploading file to Supabase…");

    try {
      const formData = new FormData();
      formData.append("file", state.file);
      formData.append("name", state.name);
      formData.append("email", state.email);
      formData.append("company", state.company);
      formData.append("notes", state.notes);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      setStatusMessage("Finalizing upload…");

      const responseText = await res.text();
      let payload: UploadApiResponse | Record<string, unknown> | null = null;

      if (responseText) {
        try {
          payload = JSON.parse(responseText) as
            | UploadApiResponse
            | Record<string, unknown>;
        } catch {
          payload = null;
        }
      }

      const payloadMessage = extractPayloadMessage(payload);
      const structuredPayload = isUploadApiResponse(payload) ? payload : null;

      if (!res.ok || !structuredPayload) {
        const fallbackStatus = res.status || 500;
        const failureMessage =
          payloadMessage ?? `Upload failed (${fallbackStatus})`;
        const failureStep =
          structuredPayload && "step" in structuredPayload
            ? structuredPayload.step
            : undefined;
        const combinedMessage = [
          failureMessage,
          failureStep ? `Step: ${failureStep}` : null,
        ]
          .filter(Boolean)
          .join(" ");
        throw new Error(combinedMessage);
      }

      if (structuredPayload.success === false) {
        const fallbackStatus = res.status || 500;
        const failureMessage =
          payloadMessage ?? `Upload failed (${fallbackStatus})`;
        const failureStep = structuredPayload.step
          ? `Step: ${structuredPayload.step}`
          : null;
        throw new Error(
          [failureMessage, failureStep].filter(Boolean).join(" "),
        );
      }

      const metadataLine =
        structuredPayload.file?.storagePath &&
        structuredPayload.metadataRecorded
          ? `Stored as ${structuredPayload.file.storagePath}.`
          : structuredPayload.metadataRecorded === false
            ? "Upload succeeded but metadata logging failed. Please check admin logs."
            : null;

      const responseMessage = [
        payloadMessage ?? "Upload complete. We’ll review your CAD shortly.",
        metadataLine,
      ]
        .filter(Boolean)
        .join(" ");

      setStatusMessage(null);

      // Success → keep contact info, reset file + notes
      setState((prev) => ({
        ...prev,
        file: null,
        fileName: null,
        notes: "",
      }));
      setSuccess(true);
      setSuccessMessage(responseMessage);
      setError(null);
    } catch (err: any) {
      console.error(err);
      setStatusMessage(null);
      setError(err?.message ?? "Upload failed. Please try again.");
      setSuccess(false);
      setSuccessMessage(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-label="Upload CAD file"
      className="relative flex flex-col rounded-3xl border border-border bg-surface p-6 sm:p-8"
    >
      {/* Drag & drop / file box */}
      <div
        className={clsx(
          "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center text-sm sm:px-8 sm:py-12",
          isDragging ? "border-accent/80 bg-accent/5" : "border-border/60",
        )}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <p className="text-xs text-muted">
          {CAD_FILE_TYPE_DESCRIPTION}. Max {MAX_UPLOAD_SIZE_LABEL}.
        </p>
        <div className="mt-4 flex flex-col items-center gap-2">
          <label
            htmlFor="file"
            className="inline-flex cursor-pointer items-center justify-center rounded-full border border-border px-4 py-2 text-xs font-medium text-foreground transition hover:border-accent hover:text-accent"
          >
            Browse from device
          </label>
          <p className="text-[11px] text-muted">
            …or drag &amp; drop into this box
          </p>
          <p className="mt-1 text-[11px] text-muted">
            Selected:{" "}
            {state.fileName ? (
              <span className="text-foreground">
                {state.fileName}
                {state.file?.size
                  ? ` · ${formatReadableBytes(state.file.size)}`
                  : null}
              </span>
            ) : (
              "No file selected yet"
            )}
          </p>
        </div>
        <input
          id="file"
          name="file"
          type="file"
          className="hidden"
          onChange={handleFileChange}
          // iOS Safari greys out STL/STEP-type extensions when accept is strict.
          // We relax it there and rely on server-side validation while keeping
          // the shared CAD_ACCEPT_STRING everywhere else for desktop UX.
          accept={fileInputAccept}
        />
      </div>

      {/* Form fields */}
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label
              htmlFor="name"
              className="text-xs font-medium text-muted tracking-wide"
            >
              Your name<span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              type="text"
              required
              value={state.name}
              onChange={handleChange("name")}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none ring-0 transition focus:border-accent"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="email"
              className="text-xs font-medium text-muted tracking-wide"
            >
              Email<span className="text-red-500">*</span>
            </label>
            <input
              id="email"
              type="email"
              required
              value={state.email}
              onChange={handleChange("email")}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none ring-0 transition focus:border-accent"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label
            htmlFor="company"
            className="text-xs font-medium text-muted tracking-wide"
          >
            Company
          </label>
          <input
            id="company"
            type="text"
            value={state.company}
            onChange={handleChange("company")}
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none ring-0 transition focus:border-accent"
          />
        </div>

        <div className="space-y-1">
          <label
            htmlFor="notes"
            className="text-xs font-medium text-muted tracking-wide"
          >
            Process / quantity / timing
          </label>
          <textarea
            id="notes"
            rows={3}
            value={state.notes}
            onChange={handleChange("notes")}
            placeholder="CNC, qty 50, target ship date, special material or tolerances..."
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none ring-0 transition focus:border-accent"
          />
        </div>

        {/* Upload CTA */}
        <div className="pt-1">
          <button
            type="submit"
            disabled={isSubmitting || !canSubmit}
            className={clsx(
              "mt-2 w-full rounded-full px-6 py-3 text-sm font-medium text-black shadow-sm transition disabled:cursor-not-allowed disabled:opacity-70",
              canSubmit && !isSubmitting
                ? "bg-emerald-500 hover:bg-emerald-400"
                : "bg-emerald-500/40",
            )}
          >
            {isSubmitting ? "Uploading..." : "Upload file"}
          </button>
        </div>

        {/* Messages */}
        <div className="min-h-[1.25rem] pt-1">
          {error && (
            <p className="text-xs text-red-400" role="alert">
              Error: {error}
            </p>
          )}
          {!error && statusMessage && (
            <p className="text-xs text-slate-400" role="status">
              {statusMessage}
            </p>
          )}
          {!error && !statusMessage && success && successMessage && (
            <p className="text-xs text-emerald-400" role="status">
              {successMessage}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}

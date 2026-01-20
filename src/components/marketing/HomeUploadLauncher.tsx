"use client";

import { useCallback, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import type { User } from "@supabase/supabase-js";
import {
  CAD_ACCEPT_STRING,
  CAD_FILE_TYPE_DESCRIPTION,
  isAllowedCadFileName,
} from "@/lib/cadFileTypes";
import { formatMaxUploadSize, isFileTooLarge } from "@/lib/uploads/uploadLimits";
import { primaryCtaClasses } from "@/lib/ctas";
import { QUOTE_INTAKE_FALLBACK_ERROR } from "@/lib/quote/messages";
import {
  finalizeQuoteIntakeEphemeralUploadAction,
  prepareQuoteIntakeEphemeralUploadAction,
  type QuoteIntakeEphemeralUploadTarget,
} from "@/app/quote/actions";
import { supabaseBrowser } from "@/lib/supabase.client";

type SelectedCadFile = {
  id: string;
  key: string;
  file: File;
};

type PrefillContact = {
  firstName: string;
  lastName: string;
  email: string;
  displayName: string;
};

type HomeUploadLauncherProps = {
  isAuthenticated: boolean;
  manufacturingProcess: string;
  processLabel?: string;
};

const MAX_FILES_PER_RFQ = 20;
const EXPORT_RESTRICTION_DEFAULT = "Not applicable / None";
const MAX_UPLOAD_SIZE_LABEL = formatMaxUploadSize();

const FILE_TYPE_ERROR_MESSAGE = `Unsupported file type. Please upload ${CAD_FILE_TYPE_DESCRIPTION}.`;

const formatStorageUploadError = (input: unknown): string => {
  const message =
    typeof (input as { message?: unknown })?.message === "string"
      ? String((input as { message?: unknown }).message)
      : "Upload failed.";
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  if (lower.includes("row-level security") || lower.includes("row level security")) {
    return "Upload permission was denied. Please try again.";
  }

  if (trimmed.length > 0 && trimmed.length <= 140 && !lower.includes("bucket=") && !lower.includes("path=")) {
    return trimmed;
  }

  return "We couldn’t upload this file. Please try again.";
};

const buildFileKey = (file: File): string => {
  const modified =
    typeof file.lastModified === "number" && Number.isFinite(file.lastModified)
      ? file.lastModified
      : 0;
  return `${file.name}:${file.size}:${modified}`;
};

const createSelectedCadFile = (file: File): SelectedCadFile => ({
  id:
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`,
  key: buildFileKey(file),
  file,
});

const buildPrefillContact = (user: User | null): PrefillContact | null => {
  if (!user) return null;

  const rawEmail = typeof user.email === "string" ? user.email.trim() : "";
  if (!rawEmail) return null;

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const metaName = typeof meta.name === "string" ? meta.name.trim() : "";

  const firstNameFromMeta =
    typeof meta.first_name === "string"
      ? meta.first_name
      : typeof meta.given_name === "string"
        ? meta.given_name
        : metaName.split(" ")[0] ?? "";

  const lastNameFromMeta =
    typeof meta.last_name === "string"
      ? meta.last_name
      : typeof meta.family_name === "string"
        ? meta.family_name
        : metaName.split(" ").slice(1).join(" ");

  const fallback = metaName || rawEmail.split("@")[0] || "Customer";
  const fallbackParts = fallback.trim().split(" ").filter(Boolean);
  const firstName = (firstNameFromMeta || fallbackParts[0] || "Customer").trim();
  const lastName = (lastNameFromMeta || fallbackParts.slice(1).join(" ") || "User").trim();

  const displayName =
    [firstName, lastName].filter(Boolean).join(" ") || metaName || rawEmail;

  return {
    firstName,
    lastName,
    email: rawEmail,
    displayName,
  };
};

export default function HomeUploadLauncher({
  isAuthenticated,
  manufacturingProcess,
  processLabel,
}: HomeUploadLauncherProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<SelectedCadFile[]>([]);
  const [quantity, setQuantity] = useState("");
  const [needByDate, setNeedByDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const hasFiles = selectedFiles.length > 0;
  const canSubmit = isAuthenticated && hasFiles && !isSubmitting;

  const resetState = useCallback(() => {
    setSelectedFiles([]);
    setQuantity("");
    setNeedByDate("");
    setError(null);
    setIsDragging(false);
    setIsSubmitting(false);
    sessionIdRef.current = null;
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    resetState();
  }, [resetState]);

  const ensureSessionId = useCallback((): string => {
    const existing = sessionIdRef.current;
    if (existing) return existing;
    const next =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().replace(/-/g, "")
        : `${Date.now().toString(36)}${Math.random().toString(16).slice(2)}`;
    sessionIdRef.current = next;
    return next;
  }, []);

  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;

    let nextError: string | null = null;

    setSelectedFiles((prev) => {
      const existingKeys = new Set(prev.map((entry) => entry.key));
      const next = [...prev];

      for (const file of files) {
        if (!isAllowedCadFileName(file.name)) {
          nextError = FILE_TYPE_ERROR_MESSAGE;
          continue;
        }
        if (isFileTooLarge(file)) {
          nextError = `Each file must be smaller than ${MAX_UPLOAD_SIZE_LABEL}.`;
          continue;
        }
        const key = buildFileKey(file);
        if (existingKeys.has(key)) {
          continue;
        }
        if (next.length >= MAX_FILES_PER_RFQ) {
          nextError = `Attach up to ${MAX_FILES_PER_RFQ} files per RFQ.`;
          break;
        }
        existingKeys.add(key);
        next.push(createSelectedCadFile(file));
      }

      return next;
    });

    setError(nextError);
  }, []);

  const handleFilePickerChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files ? Array.from(event.target.files) : [];
      if (files.length > 0) {
        addFiles(files);
      }
      event.target.value = "";
    },
    [addFiles],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const droppedFiles = Array.from(event.dataTransfer.files ?? []);
      addFiles(droppedFiles);
    },
    [addFiles],
  );

  const handleRemoveFile = useCallback((id: string) => {
    setSelectedFiles((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const orderedTargets = useMemo(() => {
    return selectedFiles.map((entry) => ({
      clientFileId: entry.id,
      fileName: entry.file.name,
      sizeBytes: entry.file.size,
      mimeType: entry.file.type || null,
    }));
  }, [selectedFiles]);

  const prepareTargets = useCallback(async () => {
    const formData = new FormData();
    formData.set("sessionId", ensureSessionId());
    formData.set("filesMeta", JSON.stringify(orderedTargets));
    return prepareQuoteIntakeEphemeralUploadAction(formData);
  }, [ensureSessionId, orderedTargets]);

  const uploadFiles = useCallback(
    async (targets: QuoteIntakeEphemeralUploadTarget[]) => {
      const targetMap = new Map<string, QuoteIntakeEphemeralUploadTarget>();
      targets.forEach((target) => targetMap.set(target.clientFileId, target));
      const sb = supabaseBrowser();

      for (const entry of selectedFiles) {
        const target = targetMap.get(entry.id);
        if (!target) {
          throw new Error("Missing upload target for one or more files.");
        }
        const { error: uploadError } = await sb.storage
          .from(target.bucketId)
          .upload(target.storagePath, entry.file, {
            cacheControl: "3600",
            upsert: false,
          });

        if (uploadError) {
          throw new Error(formatStorageUploadError(uploadError));
        }
      }
    },
    [selectedFiles],
  );

  const handleSubmit = useCallback(async () => {
    if (!isAuthenticated) {
      setError("Please sign in to upload parts and start a search.");
      return;
    }
    if (!hasFiles) {
      setError("Attach at least one CAD file before submitting.");
      return;
    }
    if (!quantity.trim()) {
      setError("Share the quantity or volumes you need.");
      return;
    }
    if (!manufacturingProcess) {
      setError("Select a manufacturing process before submitting.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const sb = supabaseBrowser();
      const { data } = await sb.auth.getUser();
      const prefill = buildPrefillContact(data.user ?? null);
      if (!prefill) {
        setError("Please sign in to upload parts and start a search.");
        return;
      }

      const prepared = await prepareTargets();
      if (!prepared.ok) {
        setError(prepared.error || QUOTE_INTAKE_FALLBACK_ERROR);
        return;
      }

      await uploadFiles(prepared.targets);

      const finalizeTargets = prepared.targets.map((target) => ({
        storagePath: target.storagePath,
        bucketId: target.bucketId,
        fileName: target.fileName,
        mimeType: target.mimeType,
        sizeBytes: target.sizeBytes,
      }));

      const finalizeForm = new FormData();
      finalizeForm.set("targets", JSON.stringify(finalizeTargets));
      finalizeForm.set("firstName", prefill.firstName);
      finalizeForm.set("lastName", prefill.lastName);
      finalizeForm.set("email", prefill.email);
      finalizeForm.set("company", "");
      finalizeForm.set("phone", "");
      finalizeForm.set("manufacturingProcess", manufacturingProcess);
      finalizeForm.set("quantity", quantity.trim());
      finalizeForm.set("shippingPostalCode", "");
      finalizeForm.set("exportRestriction", EXPORT_RESTRICTION_DEFAULT);
      finalizeForm.set("rfqReason", "");
      finalizeForm.set("notes", "");
      finalizeForm.set("targetDate", needByDate);
      finalizeForm.set("itarAcknowledged", "true");
      finalizeForm.set("termsAccepted", "true");

      const finalized = await finalizeQuoteIntakeEphemeralUploadAction(finalizeForm);
      if (!finalized.ok) {
        setError(finalized.error || QUOTE_INTAKE_FALLBACK_ERROR);
        return;
      }

      const quoteId = finalized.quoteId?.trim();
      if (quoteId) {
        router.push(`/customer/search?quote=${encodeURIComponent(quoteId)}`);
      } else {
        setError(QUOTE_INTAKE_FALLBACK_ERROR);
      }
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message.trim() : "";
      setError(message || QUOTE_INTAKE_FALLBACK_ERROR);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isAuthenticated,
    hasFiles,
    quantity,
    manufacturingProcess,
    prepareTargets,
    uploadFiles,
    needByDate,
    router,
  ]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-900/70 bg-slate-900/50 px-4 py-3 text-sm font-semibold text-ink transition hover:border-slate-700/80 hover:bg-slate-900/80"
      >
        Upload CAD/ZIP
      </button>

      {isOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Upload CAD files"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              handleClose();
            }
          }}
        >
          <div className="w-full max-w-2xl rounded-3xl border border-slate-900/70 bg-slate-950/95 p-5 shadow-[0_24px_60px_rgba(2,6,23,0.55)] sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink-soft">
                  Upload CAD/ZIP
                </p>
                <h2 className="mt-2 text-lg font-semibold text-ink">
                  Start a supplier search
                </h2>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-full border border-slate-800/80 px-3 py-1 text-xs font-semibold text-ink-soft transition hover:border-slate-700 hover:text-ink"
              >
                Close
              </button>
            </div>

            {!isAuthenticated ? (
              <div className="mt-6 rounded-2xl border border-slate-800/80 bg-slate-950/70 p-4 text-sm text-ink">
                <p>Please sign in to upload parts and start a search.</p>
                <Link
                  href="/login?next=/customer/search"
                  className={`${primaryCtaClasses} mt-4 inline-flex rounded-full px-4 py-2 text-sm`}
                >
                  Sign in
                </Link>
              </div>
            ) : (
              <div className="mt-6 space-y-5">
                {error ? (
                  <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                    {error}
                  </div>
                ) : null}

                <div className="rounded-2xl border border-slate-900/70 bg-slate-950/70 p-4">
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.3em] text-ink-soft">
                    <span>Files</span>
                    <span>{selectedFiles.length}/{MAX_FILES_PER_RFQ}</span>
                  </div>
                  <div
                    className={clsx(
                      "mt-3 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center text-sm text-ink-muted transition",
                      isDragging
                        ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100"
                        : "border-slate-900/70 hover:border-slate-700/80",
                    )}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <span className="text-sm font-semibold text-ink">
                      Drag and drop CAD or ZIP files
                    </span>
                    <span className="text-xs text-ink-soft">
                      {CAD_FILE_TYPE_DESCRIPTION} · Max {MAX_UPLOAD_SIZE_LABEL} per file
                    </span>
                    <button
                      type="button"
                      className="mt-2 rounded-full border border-slate-800/80 px-4 py-2 text-xs font-semibold text-ink-soft transition hover:border-slate-700 hover:text-ink"
                    >
                      Choose files
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={CAD_ACCEPT_STRING}
                      multiple
                      className="sr-only"
                      onChange={handleFilePickerChange}
                    />
                  </div>

                  {hasFiles ? (
                    <ul className="mt-4 space-y-2 text-sm text-ink">
                      {selectedFiles.map((entry) => (
                        <li
                          key={entry.id}
                          className="flex items-center justify-between gap-3 rounded-xl border border-slate-900/70 bg-slate-950/60 px-3 py-2"
                        >
                          <div>
                            <p className="font-medium text-ink">{entry.file.name}</p>
                            <p className="text-xs text-ink-soft">
                              {(entry.file.size / 1024 / 1024).toFixed(2)} MB
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveFile(entry.id)}
                            className="text-xs font-semibold text-ink-soft transition hover:text-ink"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-xs text-ink-soft">
                      Selected file names will appear here.
                    </p>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 rounded-2xl border border-slate-900/70 bg-slate-950/70 px-4 py-3 text-sm text-ink">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-soft">
                      Qty
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value)}
                      placeholder="50"
                      className="bg-transparent text-sm text-ink placeholder:text-ink-soft/70 focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1 rounded-2xl border border-slate-900/70 bg-slate-950/70 px-4 py-3 text-sm text-ink">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-soft">
                      Need-by date
                    </span>
                    <input
                      type="date"
                      value={needByDate}
                      onChange={(event) => setNeedByDate(event.target.value)}
                      className="bg-transparent text-sm text-ink placeholder:text-ink-soft/70 focus:outline-none"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-900/70 bg-slate-950/70 px-4 py-3 text-xs text-ink-soft">
                  <span>
                    Process: <span className="font-semibold text-ink">{processLabel || manufacturingProcess}</span>
                  </span>
                  <span>We’ll route your files to vetted suppliers.</span>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className={clsx(
                      primaryCtaClasses,
                      "rounded-full px-6 py-3 text-sm",
                      !canSubmit && "cursor-not-allowed opacity-60",
                    )}
                  >
                    {isSubmitting ? "Starting search..." : "Start search"}
                  </button>
                  <span className="text-xs text-ink-soft">
                    By uploading, you agree to start a quote intake.
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
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
import { primaryCtaClasses, secondaryCtaClasses } from "@/lib/ctas";
import { QUOTE_INTAKE_FALLBACK_ERROR } from "@/lib/quote/messages";
import {
  buildSearchProgress,
  EMPTY_SEARCH_STATE_COUNTS,
  EMPTY_SEARCH_STATE_TIMESTAMPS,
} from "@/lib/search/searchProgress";
import {
  finalizeQuoteIntakeEphemeralUploadAction,
  prepareQuoteIntakeEphemeralUploadAction,
  type QuoteIntakeEphemeralUploadTarget,
} from "@/app/quote/actions";
import { supabaseBrowser } from "@/lib/supabase.client";
import { TagPill } from "@/components/shared/primitives/TagPill";

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

type SubmissionStep = "idle" | "creating" | "uploading" | "starting";

type SubmitError = {
  message: string;
  quoteId?: string;
  uploadId?: string;
  retryable: boolean;
  continueHref?: string;
};

type HomeUploadLauncherProps = {
  isAuthenticated: boolean;
  manufacturingProcess: string;
  processLabel?: string;
  processKey?: string;
  initialQuantity?: string;
  initialNeedByDate?: string;
  autoOpen?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  prefillQuantity?: string;
  prefillNeedByDate?: string;
  hideMetaFields?: boolean;
};

const MAX_FILES_PER_RFQ = 20;
const EXPORT_RESTRICTION_DEFAULT = "Not applicable / None";
const MAX_UPLOAD_SIZE_LABEL = formatMaxUploadSize();
const SESSION_STORAGE_KEY = "home_upload_session_id";
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const FILE_TYPE_ERROR_MESSAGE = `Unsupported file type. Please upload ${CAD_FILE_TYPE_DESCRIPTION}.`;

const SUBMISSION_STATUS_LABELS: Record<Exclude<SubmissionStep, "idle">, string> = {
  creating: "Creating quote...",
  uploading: "Uploading files...",
  starting: "Starting search...",
};

const parseSubmitError = (
  message: string,
): {
  message: string;
  quoteId?: string;
  uploadId?: string;
} => {
  const normalized = message.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return { message: QUOTE_INTAKE_FALLBACK_ERROR };
  }

  const quoteMatch = normalized.match(/Quote ID ([A-Za-z0-9-]+)/i);
  const uploadMatch = normalized.match(/Upload ID ([A-Za-z0-9-]+)/i);
  if (!quoteMatch && !uploadMatch) {
    return { message: normalized };
  }

  const quoteId = quoteMatch?.[1];
  const uploadId = uploadMatch?.[1];
  let cleaned = normalized
    .replace(/(?:with\s+)?Quote ID [A-Za-z0-9-]+\.?/i, "")
    .replace(/(?:with\s+)?Upload ID [A-Za-z0-9-]+\.?/i, "")
    .trim();
  cleaned = cleaned.replace(/\s*[·•]\s*/g, " ").replace(/\s+with\s*$/i, "");
  cleaned = cleaned.replace(/\s+\./g, ".").trim();
  return { message: cleaned || normalized, quoteId, uploadId };
};

const buildSubmitError = (
  message: string,
  retryable: boolean,
  detail?: { quoteId?: string; uploadId?: string; continueHref?: string },
): SubmitError => {
  const parsed = parseSubmitError(message);
  return {
    message: parsed.message,
    quoteId: detail?.quoteId ?? parsed.quoteId,
    uploadId: detail?.uploadId ?? parsed.uploadId,
    retryable,
    continueHref: detail?.continueHref,
  };
};

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

function getTodayLocalISODate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isValidIsoDate(isoDate: string): boolean {
  if (!ISO_DATE_REGEX.test(isoDate)) return false;
  const [y, m, d] = isoDate.split("-").map((v) => Number(v));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (!Number.isFinite(dt.getTime())) return false;
  return dt.toISOString().slice(0, 10) === isoDate;
}

function isIsoDateInPast(isoDate: string): boolean {
  if (!isValidIsoDate(isoDate)) return false;
  return isoDate < getTodayLocalISODate();
}

const createSelectedCadFile = (file: File): SelectedCadFile => ({
  id:
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`,
  key: buildFileKey(file),
  file,
});

const hashString = async (value: string): Promise<string> => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined" &&
    typeof TextEncoder !== "undefined"
  ) {
    const data = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  let hashA = 0;
  let hashB = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    hashA = (hashA * 31 + code) >>> 0;
    hashB = (hashB * 33 + code) >>> 0;
  }
  return `${hashA.toString(16).padStart(8, "0")}${hashB.toString(16).padStart(8, "0")}`;
};

const buildFileListHash = async (files: SelectedCadFile[]): Promise<string> => {
  const keys = files.map((entry) => entry.key).sort();
  return hashString(keys.join("|"));
};

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
  processKey,
  initialQuantity = "",
  initialNeedByDate = "",
  autoOpen = false,
  isOpen,
  onOpenChange,
  hideTrigger = false,
  prefillQuantity,
  prefillNeedByDate,
  hideMetaFields = false,
}: HomeUploadLauncherProps) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(autoOpen);
  const resolvedOpen = isOpen ?? internalOpen;
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<SelectedCadFile[]>([]);
  const [quantity, setQuantity] = useState(initialQuantity);
  const [needByDate, setNeedByDate] = useState(initialNeedByDate);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [submissionStep, setSubmissionStep] = useState<SubmissionStep>("idle");
  const [lastFailedStep, setLastFailedStep] = useState<SubmissionStep | null>(null);
  const [redirectingQuoteId, setRedirectingQuoteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const preparedTargetsRef = useRef<QuoteIntakeEphemeralUploadTarget[] | null>(null);
  const uploadedFileIdsRef = useRef<Set<string>>(new Set());
  const idempotencyKeyRef = useRef<string | null>(null);
  const idempotencyFingerprintRef = useRef<string | null>(null);
  const redirectTimerRef = useRef<number | null>(null);
  const redirectingQuoteIdRef = useRef<string | null>(null);
  const activeStepRef = useRef<SubmissionStep>("idle");
  const lastFileSignatureRef = useRef<string>("");

  const hasFiles = selectedFiles.length > 0;
  const isRedirecting = Boolean(redirectingQuoteId);
  const canSubmit = isAuthenticated && hasFiles && !isSubmitting && !isRedirecting;

  const setOpen = useCallback(
    (next: boolean) => {
      if (isOpen === undefined) {
        setInternalOpen(next);
      }
      onOpenChange?.(next);
    },
    [isOpen, onOpenChange],
  );

  useEffect(() => {
    if (typeof prefillQuantity === "string") {
      setQuantity(prefillQuantity);
    }
  }, [prefillQuantity]);

  useEffect(() => {
    if (typeof prefillNeedByDate === "string") {
      setNeedByDate(prefillNeedByDate);
    }
  }, [prefillNeedByDate]);

  const clearRedirectTimer = useCallback(() => {
    if (redirectTimerRef.current !== null) {
      clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }
  }, []);

  const resetState = useCallback(() => {
    clearRedirectTimer();
    setSelectedFiles([]);
    setQuantity("");
    setNeedByDate("");
    setSubmitError(null);
    setIsDragging(false);
    setIsSubmitting(false);
    setSubmissionStep("idle");
    setLastFailedStep(null);
    setRedirectingQuoteId(null);
    sessionIdRef.current = null;
    preparedTargetsRef.current = null;
    uploadedFileIdsRef.current = new Set();
    idempotencyKeyRef.current = null;
    idempotencyFingerprintRef.current = null;
    redirectingQuoteIdRef.current = null;
    activeStepRef.current = "idle";
  }, [clearRedirectTimer]);

  useEffect(() => {
    return () => {
      clearRedirectTimer();
    };
  }, [clearRedirectTimer]);

  const handleClose = useCallback(() => {
    setOpen(false);
    resetState();
  }, [resetState, setOpen]);

  const ensureSessionId = useCallback((): string => {
    const existing = sessionIdRef.current;
    if (existing) return existing;
    const stored =
      typeof window !== "undefined" ? window.sessionStorage.getItem(SESSION_STORAGE_KEY) : null;
    if (stored && /^[a-zA-Z0-9_-]{8,128}$/.test(stored)) {
      sessionIdRef.current = stored;
      return stored;
    }
    const next =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().replace(/-/g, "")
        : `${Date.now().toString(36)}${Math.random().toString(16).slice(2)}`;
    sessionIdRef.current = next;
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, next);
      } catch {
        // Ignore storage failures (e.g. blocked cookies).
      }
    }
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
          nextError = `Attach up to ${MAX_FILES_PER_RFQ} files per search request.`;
          break;
        }
        existingKeys.add(key);
        next.push(createSelectedCadFile(file));
      }

      return next;
    });

    setSubmitError(nextError ? buildSubmitError(nextError, false) : null);
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

  const fileSignature = useMemo(() => {
    if (selectedFiles.length === 0) return "";
    return selectedFiles
      .map((entry) => entry.key)
      .sort()
      .join("|");
  }, [selectedFiles]);

  useEffect(() => {
    if (!fileSignature) {
      preparedTargetsRef.current = null;
      uploadedFileIdsRef.current = new Set();
      idempotencyKeyRef.current = null;
      idempotencyFingerprintRef.current = null;
      lastFileSignatureRef.current = "";
      setSubmitError(null);
      setLastFailedStep(null);
      return;
    }

    if (lastFileSignatureRef.current && lastFileSignatureRef.current !== fileSignature) {
      preparedTargetsRef.current = null;
      uploadedFileIdsRef.current = new Set();
      idempotencyKeyRef.current = null;
      idempotencyFingerprintRef.current = null;
      setSubmitError(null);
      setLastFailedStep(null);
    }
    lastFileSignatureRef.current = fileSignature;
  }, [fileSignature]);

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
        if (uploadedFileIdsRef.current.has(entry.id)) {
          continue;
        }
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
          const rawMessage =
            typeof (uploadError as { message?: unknown })?.message === "string"
              ? String((uploadError as { message?: unknown }).message).toLowerCase()
              : "";
          if (rawMessage.includes("already exists") || rawMessage.includes("duplicate")) {
            uploadedFileIdsRef.current.add(entry.id);
            continue;
          }
          throw new Error(formatStorageUploadError(uploadError));
        }
        uploadedFileIdsRef.current.add(entry.id);
      }
    },
    [selectedFiles],
  );

  const setActiveStep = useCallback((step: SubmissionStep) => {
    activeStepRef.current = step;
    setSubmissionStep(step);
  }, []);

  const areUploadsComplete = useCallback(() => {
    return selectedFiles.every((entry) => uploadedFileIdsRef.current.has(entry.id));
  }, [selectedFiles]);

  const getIdempotencyKey = useCallback(async () => {
    const sessionId = ensureSessionId();
    const fileHash = await buildFileListHash(selectedFiles);
    const fingerprint = [
      sessionId,
      fileHash,
      manufacturingProcess.trim(),
      quantity.trim(),
      needByDate.trim(),
    ].join("|");

    if (idempotencyFingerprintRef.current === fingerprint && idempotencyKeyRef.current) {
      return idempotencyKeyRef.current;
    }

    const key = await hashString(fingerprint);
    idempotencyFingerprintRef.current = fingerprint;
    idempotencyKeyRef.current = key;
    return key;
  }, [ensureSessionId, manufacturingProcess, needByDate, quantity, selectedFiles]);

  const attemptRedirect = useCallback(
    (quoteId: string, uploadId?: string | null) => {
      const trimmedQuoteId = quoteId.trim();
      if (!trimmedQuoteId) {
        setSubmitError(buildSubmitError(QUOTE_INTAKE_FALLBACK_ERROR, true));
        return;
      }

      const continueHref = `/customer/search?quote=${encodeURIComponent(trimmedQuoteId)}`;
      redirectingQuoteIdRef.current = trimmedQuoteId;
      setRedirectingQuoteId(trimmedQuoteId);

      const currentLocation =
        typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "";

      try {
        router.push(continueHref);
      } catch (error) {
        redirectingQuoteIdRef.current = null;
        setRedirectingQuoteId(null);
        activeStepRef.current = "idle";
        setSubmitError(
          buildSubmitError("We created your quote, but couldn’t redirect automatically.", false, {
            quoteId: trimmedQuoteId,
            uploadId: uploadId ?? undefined,
            continueHref,
          }),
        );
        setSubmissionStep("idle");
        return;
      }

      if (typeof window !== "undefined") {
        clearRedirectTimer();
        redirectTimerRef.current = window.setTimeout(() => {
          const now = `${window.location.pathname}${window.location.search}`;
          if (now === currentLocation) {
            redirectingQuoteIdRef.current = null;
            setRedirectingQuoteId(null);
            activeStepRef.current = "idle";
            setSubmissionStep("idle");
            setSubmitError(
              buildSubmitError("We created your quote, but couldn’t redirect automatically.", false, {
                quoteId: trimmedQuoteId,
                uploadId: uploadId ?? undefined,
                continueHref,
              }),
            );
          }
        }, 1500);
      }
    },
    [clearRedirectTimer, router],
  );

  const runSubmission = useCallback(
    async (startAt: SubmissionStep) => {
      if (isSubmitting || isRedirecting) return;
      const normalizedStart = startAt === "idle" ? "creating" : startAt;
      if (!isAuthenticated) {
        setSubmitError(buildSubmitError("Please sign in to upload parts and start a search.", false));
        return;
      }
      if (!hasFiles) {
        setSubmitError(buildSubmitError("Attach at least one CAD file before submitting.", false));
        return;
      }
      if (!quantity.trim()) {
        setSubmitError(buildSubmitError("Share the quantity or volumes you need.", false));
        return;
      }
      const trimmedNeedBy = needByDate.trim();
      if (trimmedNeedBy && !isValidIsoDate(trimmedNeedBy)) {
        setSubmitError(buildSubmitError("Enter a valid need-by date.", false));
        return;
      }
      if (trimmedNeedBy && isIsoDateInPast(trimmedNeedBy)) {
        setSubmitError(buildSubmitError("Need-by date can’t be in the past.", false));
        return;
      }
      if (!manufacturingProcess) {
        setSubmitError(buildSubmitError("Select a manufacturing process before submitting.", false));
        return;
      }

      setIsSubmitting(true);
      setSubmitError(null);
      setLastFailedStep(null);
      activeStepRef.current = "idle";

      try {
        const sb = supabaseBrowser();
        const { data } = await sb.auth.getUser();
        const prefill = buildPrefillContact(data.user ?? null);
        if (!prefill) {
          setSubmitError(buildSubmitError("Please sign in to upload parts and start a search.", false));
          return;
        }

        let targets = preparedTargetsRef.current;
        if (!targets) {
          setActiveStep("creating");
          const prepared = await prepareTargets();
          if (!prepared.ok) {
            setLastFailedStep("creating");
            setSubmitError(buildSubmitError(prepared.error || QUOTE_INTAKE_FALLBACK_ERROR, true));
            return;
          }
          targets = prepared.targets;
          preparedTargetsRef.current = targets;
        }

        const uploadsComplete = areUploadsComplete();
        if (!uploadsComplete) {
          setActiveStep("uploading");
          await uploadFiles(targets);
        }

        setActiveStep("starting");
        const finalizeTargets = targets.map((target) => ({
          storagePath: target.storagePath,
          bucketId: target.bucketId,
          fileName: target.fileName,
          mimeType: target.mimeType,
          sizeBytes: target.sizeBytes,
        }));

        const idempotencyKey = await getIdempotencyKey();
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
        finalizeForm.set("idempotencyKey", idempotencyKey);

        const finalized = await finalizeQuoteIntakeEphemeralUploadAction(finalizeForm);
        if (!finalized.ok) {
          setLastFailedStep("starting");
          setSubmitError(
            buildSubmitError(finalized.error || QUOTE_INTAKE_FALLBACK_ERROR, true, {
              quoteId: finalized.quoteId,
              uploadId: finalized.uploadId,
            }),
          );
          return;
        }

        const quoteId = finalized.quoteId?.trim();
        if (quoteId) {
          attemptRedirect(quoteId, finalized.uploadId);
        } else {
          setLastFailedStep("starting");
          setSubmitError(
            buildSubmitError(QUOTE_INTAKE_FALLBACK_ERROR, true, {
              uploadId: finalized.uploadId,
            }),
          );
        }
      } catch (submitError) {
        const message = submitError instanceof Error ? submitError.message.trim() : "";
        const failedStep =
          activeStepRef.current !== "idle" ? activeStepRef.current : normalizedStart;
        setLastFailedStep(failedStep);
        setSubmitError(buildSubmitError(message || QUOTE_INTAKE_FALLBACK_ERROR, true));
      } finally {
        setIsSubmitting(false);
        if (!redirectingQuoteIdRef.current) {
          setSubmissionStep("idle");
          activeStepRef.current = "idle";
        }
      }
    },
    [
      areUploadsComplete,
      attemptRedirect,
      getIdempotencyKey,
      hasFiles,
      isAuthenticated,
      isRedirecting,
      isSubmitting,
      manufacturingProcess,
      needByDate,
      prepareTargets,
      quantity,
      setActiveStep,
      uploadFiles,
    ],
  );

  const handleSubmit = useCallback(() => {
    void runSubmission("creating");
  }, [runSubmission]);

  const handleRetry = useCallback(() => {
    const retryStep = lastFailedStep && lastFailedStep !== "idle" ? lastFailedStep : "creating";
    void runSubmission(retryStep);
  }, [lastFailedStep, runSubmission]);

  const progressLabel =
    submissionStep !== "idle" ? SUBMISSION_STATUS_LABELS[submissionStep] : null;
  const postRedirectHref = redirectingQuoteId
    ? `/customer/search?quote=${encodeURIComponent(redirectingQuoteId)}`
    : null;
  const postRedirectProgress = redirectingQuoteId
    ? buildSearchProgress({
        counts: EMPTY_SEARCH_STATE_COUNTS,
        timestamps: EMPTY_SEARCH_STATE_TIMESTAMPS,
        statusLabel: "searching",
        recommendedAction: "refresh",
        quoteId: redirectingQuoteId,
        isInitializing: true,
      })
    : null;
  const loginHref = useMemo(() => {
    const params = new URLSearchParams();
    if (processKey) {
      params.set("process", processKey);
    }
    const trimmedQuantity = quantity.trim();
    if (trimmedQuantity) {
      params.set("qty", trimmedQuantity);
    }
    if (needByDate) {
      params.set("needBy", needByDate);
    }
    params.set("upload", "1");
    const nextPath = params.toString() ? `/?${params.toString()}` : "/";
    return `/login?next=${encodeURIComponent(nextPath)}`;
  }, [processKey, quantity, needByDate]);

  return (
    <>
      {!hideTrigger ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-900/70 bg-slate-900/50 px-4 py-3 text-sm font-semibold text-ink transition hover:border-slate-700/80 hover:bg-slate-900/80"
        >
          Upload CAD/ZIP
        </button>
      ) : null}

      {resolvedOpen ? (
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

            <div className="mt-6 space-y-5">
              {!isAuthenticated ? (
                <div className="rounded-2xl border border-slate-900/70 bg-slate-950/70 px-4 py-3 text-xs text-ink-soft">
                  Sign in to upload parts and start a search.
                </div>
              ) : null}

              {submitError ? (
                <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  <p className="font-semibold text-red-100">{submitError.message}</p>
                  {submitError.quoteId ? (
                    <p className="mt-1 text-xs text-red-200">Quote ID: {submitError.quoteId}</p>
                  ) : null}
                  {submitError.uploadId ? (
                    <p className="mt-1 text-xs text-red-200">Upload ID: {submitError.uploadId}</p>
                  ) : null}
                  {submitError.retryable || submitError.continueHref ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {submitError.retryable ? (
                        <button
                          type="button"
                          onClick={() => void handleRetry()}
                          className={`${secondaryCtaClasses} rounded-full px-4 py-2 text-xs`}
                        >
                          Try again
                        </button>
                      ) : null}
                      {submitError.continueHref ? (
                        <Link
                          href={submitError.continueHref}
                          className={`${secondaryCtaClasses} rounded-full px-4 py-2 text-xs`}
                        >
                          Continue
                        </Link>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {progressLabel ? (
                <div
                  className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"
                  aria-live="polite"
                >
                  {progressLabel}
                </div>
              ) : null}

              {postRedirectProgress ? (
                <div className="rounded-2xl border border-slate-900/70 bg-slate-950/70 px-4 py-3 text-sm text-ink">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-ink">
                        {postRedirectProgress.statusHeadline}
                      </p>
                      <p className="text-xs text-ink-soft">{postRedirectProgress.statusDetail}</p>
                    </div>
                    <TagPill size="sm" tone="slate" className="normal-case tracking-normal">
                      {postRedirectProgress.statusTag}
                    </TagPill>
                  </div>
                  {postRedirectHref ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Link
                        href={postRedirectHref}
                        className={`${secondaryCtaClasses} rounded-full px-4 py-2 text-xs`}
                      >
                        Open search
                      </Link>
                    </div>
                  ) : null}
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

              {!hideMetaFields ? (
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
                    min={getTodayLocalISODate()}
                      value={needByDate}
                      onChange={(event) => setNeedByDate(event.target.value)}
                      className="bg-transparent text-sm text-ink placeholder:text-ink-soft/70 focus:outline-none"
                    />
                  </label>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-900/70 bg-slate-950/70 px-4 py-3 text-xs text-ink-soft">
                <span>
                  Process: <span className="font-semibold text-ink">{processLabel || manufacturingProcess}</span>
                </span>
                <span>We’ll match you with vetted suppliers.</span>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                {isAuthenticated ? (
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
                    {progressLabel ?? "Start search"}
                  </button>
                ) : (
                  <Link
                    href={loginHref}
                    className={clsx(primaryCtaClasses, "rounded-full px-6 py-3 text-sm")}
                  >
                    Sign in to start search
                  </Link>
                )}
                <span className="text-xs text-ink-soft">
                  By uploading, you agree to start a quote intake.
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

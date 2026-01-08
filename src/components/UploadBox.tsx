"use client";

import {
  useState,
  DragEvent,
  ChangeEvent,
  FormEvent,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import dynamic from "next/dynamic";
import clsx from "clsx";
import {
  CAD_ACCEPT_STRING,
  CAD_FILE_TYPE_DESCRIPTION,
  bytesToMegabytes,
  isAllowedCadFileName,
} from "@/lib/cadFileTypes";
import { formatMaxUploadSize, isFileTooLarge } from "@/lib/uploads/uploadLimits";
import { primaryCtaClasses } from "@/lib/ctas";
import {
  finalizeQuoteIntakeEphemeralUploadAction,
  prepareQuoteIntakeEphemeralUploadAction,
  type QuoteIntakeEphemeralUploadTarget,
} from "@/app/quote/actions";
import { QUOTE_INTAKE_FALLBACK_ERROR } from "@/lib/quote/messages";
import type { CadViewerPanelProps } from "@/app/(portals)/components/CadViewerPanel";
import { PartDfMPanel } from "@/app/(portals)/components/PartDfMPanel";
import type { GeometryStats } from "@/lib/dfm/basicPartChecks";
import { supabaseBrowser } from "@/lib/supabase.client";
import { classifyCadFileType } from "@/lib/cadRendering";
import { CadPreviewModal } from "@/components/shared/CadPreviewModal";
import { ThreeCadViewer } from "@/components/ThreeCadViewer";

type StorageErrorLike = {
  message?: unknown;
  error?: unknown;
  statusCode?: unknown;
};

const formatStorageUploadError = (input: {
  error: unknown;
  bucket: string;
  path: string;
}): string => {
  const err = input.error as StorageErrorLike | null;
  const message =
    typeof err?.message === "string" && err.message.trim()
      ? err.message.trim()
      : typeof err?.error === "string" && err.error.trim()
        ? err.error.trim()
        : "Upload failed.";
  const lower = message.toLowerCase();

  // Customer-facing summary: avoid internal bucket/path/policy details.
  if (lower.includes("row-level security") || lower.includes("row level security")) {
    return "Upload permission was denied. Please try again, or contact support if the issue persists.";
  }

  // Preserve any concrete message if it seems user-comprehensible; otherwise keep it generic.
  if (message.length > 0 && message.length <= 140 && !lower.includes("bucket=") && !lower.includes("path=")) {
    return message;
  }

  return "We couldn’t upload this file. Please try again.";
};

const CadViewerPanel = dynamic<CadViewerPanelProps>(
  () =>
    import("@/app/(portals)/components/CadViewerPanel").then(
      (mod) => mod.CadViewerPanel,
    ),
  { ssr: false },
);

const MANUFACTURING_PROCESS_OPTIONS = [
  "CNC machining",
  "3D printing",
  "Sheet metal",
  "Injection molding",
  "Not sure yet",
] as const;

const EXPORT_RESTRICTION_OPTIONS = [
  "Not applicable / None",
  "ITAR",
  "EAR",
  "EU Dual Use",
  "Other / Unsure",
] as const;

const RFQ_REASON_OPTIONS = [
  "Need a quote for a new project",
  "Comparing suppliers",
  "Existing production, looking for backup",
  "Just exploring capabilities",
] as const;

const UPLOAD_EXPLAINER_POINTS = [
  "We privately route your part to vetted suppliers on your behalf.",
  "You’ll get one or more quotes in your customer workspace.",
  "You stay in control—no obligation to award a job.",
];

const MAX_FILES_PER_RFQ = 20;
const MAX_UPLOAD_SIZE_LABEL = formatMaxUploadSize();

/**
 * Minimal, easily testable iOS/iPadOS detector. Modern iPadOS (13+) reports
 * itself as "Macintosh" but still includes the "Mobile" token in the UA.
 */
const isIOSUserAgent = (userAgent: string): boolean => {
  if (!userAgent) return false;
  if (/(ipad|iphone|ipod)/i.test(userAgent)) return true;
  return /macintosh/i.test(userAgent) && /mobile/i.test(userAgent);
};

type SelectedCadFile = {
  id: string;
  file: File;
  objectUrl: string;
  addedAt: number;
};

type UploadedPreviewRef = {
  bucket: string;
  path: string;
  token: string;
};

type UploadProgressState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "uploaded" }
  | { status: "failed"; errorReason: string; step: "prepare" | "upload" | "proof" | "finalize" };

type StorageProofState =
  | { status: "unknown" }
  | { status: "checking" }
  | { status: "ok"; bytes: number | null; url: string; httpStatus: number; raw: string | null }
  | { status: "missing"; url: string; httpStatus: number; raw: string | null }
  | { status: "failed"; errorReason: string; url: string; httpStatus: number; raw: string | null };

type PreviewAttemptDiagnostics = {
  ok: boolean;
  status: number;
  contentType: string | null;
  bytes: number;
  errorText: string | null;
  requestId?: string | null;
  edgeStatus?: number | null;
  attemptedAt: number;
};

type SimpleFetchResult = {
  status: number;
  text: string;
  attemptedAt: number;
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
  file,
  objectUrl: URL.createObjectURL(file),
  addedAt: Date.now(),
});

const disposeSelectedCadFiles = (
  entries: SelectedCadFile | SelectedCadFile[] | null | undefined,
) => {
  if (!entries) {
    return;
  }
  const list = Array.isArray(entries) ? entries : [entries];
  list.forEach((entry) => {
    if (entry?.objectUrl) {
      URL.revokeObjectURL(entry.objectUrl);
    }
  });
};

type UploadState = {
  files: SelectedCadFile[];
  selectedFileId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  phone: string;
  manufacturingProcess: string;
  quantity: string;
  shippingPostalCode: string;
  exportRestriction: string;
  rfqReason: string;
  notes: string;
  itarAcknowledged: boolean;
  termsAccepted: boolean;
};

export type PrefillContact = {
  firstName: string;
  lastName: string;
  email: string;
  displayName: string;
};

type UploadBoxProps = {
  prefillContact?: PrefillContact | null;
  showExplainer?: boolean;
};

const FIELD_ERROR_KEYS = [
  "file",
  "firstName",
  "lastName",
  "email",
  "manufacturingProcess",
  "quantity",
  "shippingPostalCode",
  "exportRestriction",
  "itarAcknowledged",
  "termsAccepted",
] as const;

type FieldErrorKey = (typeof FIELD_ERROR_KEYS)[number];

type FieldErrors = Partial<Record<FieldErrorKey, string>>;

const EMPTY_UPLOAD_STATE: UploadState = {
  files: [],
  selectedFileId: null,
  firstName: "",
  lastName: "",
  email: "",
  company: "",
  phone: "",
  manufacturingProcess: "",
  quantity: "",
  shippingPostalCode: "",
  exportRestriction: "",
  rfqReason: "",
  notes: "",
  itarAcknowledged: false,
  termsAccepted: false,
};

const CONTACT_FIELD_KEYS: Array<keyof Pick<
  UploadState,
  "firstName" | "lastName" | "email"
>> = ["firstName", "lastName", "email"];

function buildInitialUploadState(prefill?: PrefillContact | null): UploadState {
  return {
    ...EMPTY_UPLOAD_STATE,
    firstName: prefill?.firstName ?? "",
    lastName: prefill?.lastName ?? "",
    email: prefill?.email ?? "",
  };
}

const FILE_TYPE_ERROR_MESSAGE = `Unsupported file type. Please upload ${CAD_FILE_TYPE_DESCRIPTION}.`;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

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

  if (file.size === 0) {
    return "File is empty. Please choose a different CAD file.";
  }

  return null;
};

const validateFormFields = (state: UploadState): FieldErrors => {
  const errors: FieldErrors = {};
  const trimmedFirstName = state.firstName.trim();
  const trimmedLastName = state.lastName.trim();
  const trimmedEmail = state.email.trim();
  const trimmedQuantity = state.quantity.trim();
  const postal = state.shippingPostalCode;

  if (!state.files || state.files.length === 0) {
    errors.file = "Attach at least one CAD file before submitting.";
  }
  if (!trimmedFirstName) {
    errors.firstName = "First name is required.";
  }
  if (!trimmedLastName) {
    errors.lastName = "Last name is required.";
  }
  if (!trimmedEmail) {
    errors.email = "Business email is required.";
  } else if (!EMAIL_REGEX.test(trimmedEmail)) {
    errors.email = "Enter a valid email address.";
  }
  if (!state.manufacturingProcess) {
    errors.manufacturingProcess = "Select a manufacturing process.";
  }
  if (!trimmedQuantity) {
    errors.quantity = "Share the quantity or volumes you need.";
  }
  if (postal && !postal.trim()) {
    errors.shippingPostalCode = "Enter a postal code or leave this blank.";
  }
  if (!state.exportRestriction) {
    errors.exportRestriction = "Select the export restriction.";
  }
  if (!state.itarAcknowledged) {
    errors.itarAcknowledged =
      "Please confirm these parts are not subject to ITAR.";
  }
  if (!state.termsAccepted) {
    errors.termsAccepted = "Please accept the terms before submitting.";
  }

  return errors;
};

const hasErrors = (fieldErrors: FieldErrors) =>
  Object.keys(fieldErrors).length > 0;

export default function UploadBox({
  prefillContact,
  showExplainer = false,
}: UploadBoxProps) {
  const baseState = useMemo(
    () => buildInitialUploadState(prefillContact),
    [prefillContact],
  );
  const [state, setState] = useState<UploadState>(() => ({ ...baseState }));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isIOSDevice, setIsIOSDevice] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadedRefs, setUploadedRefs] = useState<Record<string, UploadedPreviewRef>>({});
  const [uploadProgress, setUploadProgress] = useState<Record<string, UploadProgressState>>({});
  const [uploadTargets, setUploadTargets] = useState<Record<string, QuoteIntakeEphemeralUploadTarget>>({});
  const [storageProof, setStorageProof] = useState<Record<string, StorageProofState>>({});
  const [uploadBucketId, setUploadBucketId] = useState<string | null>(null);
  const uploadSessionIdRef = useRef<string | null>(null);
  const [previewOpenForId, setPreviewOpenForId] = useState<string | null>(null);
  const [previewDiagnostics, setPreviewDiagnostics] = useState<Record<string, PreviewAttemptDiagnostics | null>>({});
  const [previewDiagnosticsPending, setPreviewDiagnosticsPending] = useState<Record<string, boolean>>({});
  const [pingResult, setPingResult] = useState<SimpleFetchResult | null>(null);
  const [pingPending, setPingPending] = useState(false);
  const [forceFetchResult, setForceFetchResult] = useState<SimpleFetchResult | null>(null);
  const [forceFetchPending, setForceFetchPending] = useState(false);
  const [permissionTestResult, setPermissionTestResult] = useState<SimpleFetchResult | null>(null);
  const [permissionTestPending, setPermissionTestPending] = useState(false);
  const [proofCanaryResult, setProofCanaryResult] = useState<{
    upload: { ok: boolean; errorText: string | null; bucket: string; path: string };
    proof: { ok: boolean; status: number; text: string };
    attemptedAt: number;
  } | null>(null);
  const [proofCanaryPending, setProofCanaryPending] = useState(false);
  const [geometryStatsMap, setGeometryStatsMap] = useState<
    Record<string, GeometryStats | null>
  >({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const contactFieldsLocked = Boolean(prefillContact);
  const contactFieldLockSet = contactFieldsLocked
    ? new Set<InputFieldKey>(["email"])
    : null;
  const resetUploadState = useCallback(() => {
    setState((prev) => {
      disposeSelectedCadFiles(prev.files);
      return { ...baseState };
    });
    setGeometryStatsMap({});
    setUploadedRefs({});
    setUploadProgress({});
    setUploadTargets({});
    setStorageProof({});
    setUploadBucketId(null);
    uploadSessionIdRef.current = null;
    setPreviewOpenForId(null);
    setPreviewDiagnostics({});
    setPreviewDiagnosticsPending({});
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [baseState]);

  useEffect(() => {
    if (!prefillContact) {
      return;
    }
    setState((prev) => {
      const next = { ...prev };
      CONTACT_FIELD_KEYS.forEach((key) => {
        next[key] = baseState[key];
      });
      return next;
    });
  }, [baseState, prefillContact]);

  const syncFileInputWithFiles = useCallback((files: File[] | null) => {
    const input = fileInputRef.current;
    if (!input) {
      return;
    }

    if (!files || files.length === 0) {
      input.value = "";
      return;
    }

    if (typeof DataTransfer === "undefined") {
      return;
    }

    try {
      const dataTransfer = new DataTransfer();
      files.forEach((candidate) => dataTransfer.items.add(candidate));
      input.files = dataTransfer.files;
    } catch (syncError) {
      console.warn("[quote intake] unable to sync file input", syncError);
    }
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setIsIOSDevice(isIOSUserAgent(navigator.userAgent));
  }, []);

  const filesRef = useRef<SelectedCadFile[]>([]);
  useEffect(() => {
    filesRef.current = state.files;
  }, [state.files]);

  useEffect(() => {
    return () => {
      disposeSelectedCadFiles(filesRef.current);
    };
  }, []);

  useEffect(() => {
    syncFileInputWithFiles(state.files.map((entry) => entry.file));
  }, [state.files, syncFileInputWithFiles]);

  const hasFilesAttached = state.files.length > 0;
  const allFilesUploaded = useMemo(() => {
    if (state.files.length === 0) return false;
    return state.files.every((entry) => uploadProgress[entry.id]?.status === "uploaded");
  }, [state.files, uploadProgress]);
  const canSubmit = Boolean(
    hasFilesAttached &&
      state.firstName.trim() &&
      state.lastName.trim() &&
      state.email.trim() &&
      state.manufacturingProcess &&
      state.quantity.trim() &&
      state.exportRestriction &&
      state.itarAcknowledged &&
      state.termsAccepted &&
      allFilesUploaded,
  );
  const fileInputAccept = isIOSDevice ? undefined : CAD_ACCEPT_STRING;
  const selectedPart = useMemo(() => {
    if (state.files.length === 0) {
      return null;
    }
    if (state.selectedFileId) {
      return (
        state.files.find((entry) => entry.id === state.selectedFileId) ??
        state.files[0]
      );
    }
    return state.files[0];
  }, [state.files, state.selectedFileId]);
  const selectedUploadedRef = selectedPart ? uploadedRefs[selectedPart.id] ?? null : null;
  const selectedUploadStatus: UploadProgressState["status"] | null = useMemo(() => {
    if (!selectedPart) return null;
    const progress = uploadProgress[selectedPart.id]?.status;
    if (progress) return progress;
    return uploadedRefs[selectedPart.id] ? "uploaded" : "idle";
  }, [selectedPart, uploadProgress, uploadedRefs]);
  const selectedKindInfo = useMemo(() => {
    if (!selectedPart) return { ok: false as const };
    return classifyCadFileType({ filename: selectedPart.file.name, extension: null });
  }, [selectedPart]);
  const selectedCadKind = selectedKindInfo.ok ? selectedKindInfo.type : null;
  const selectedPreviewUrl = useMemo(() => {
    if (!selectedUploadedRef?.token) return null;
    const qs = new URLSearchParams();
    qs.set("token", selectedUploadedRef.token);
    if (selectedCadKind) {
      qs.set("kind", selectedCadKind);
    }
    qs.set("disposition", "inline");
    return `/api/cad-preview?${qs.toString()}`;
  }, [selectedUploadedRef?.token, selectedCadKind]);
  const selectedPreviewDiagnostics = selectedPart ? previewDiagnostics[selectedPart.id] ?? null : null;
  const selectedPreviewDiagnosticsPending = selectedPart
    ? Boolean(previewDiagnosticsPending[selectedPart.id])
    : false;
  const selectedStorageProof = selectedPart ? storageProof[selectedPart.id] ?? { status: "unknown" as const } : null;

  const runPreviewTest = useCallback(
    async (input: { fileId: string; previewUrl: string }) => {
      setPreviewDiagnosticsPending((prev) => ({ ...prev, [input.fileId]: true }));
      try {
        const res = await fetch(input.previewUrl, {
          method: "GET",
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
        });
        const ct = res.headers.get("content-type");
        const errorText = !res.ok ? await res.clone().text().catch(() => "") : null;
        let requestId: string | null = null;
        let edgeStatus: number | null = null;
        if (!res.ok && errorText) {
          try {
            const parsed = JSON.parse(errorText) as any;
            requestId = typeof parsed?.requestId === "string" ? parsed.requestId : null;
            edgeStatus = typeof parsed?.edgeStatus === "number" ? parsed.edgeStatus : null;
          } catch {
            // ignore
          }
        }
        const buf = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
        setPreviewDiagnostics((prev) => ({
          ...prev,
          [input.fileId]: {
            ok: res.ok,
            status: res.status,
            contentType: ct,
            bytes: buf.byteLength,
            errorText: res.ok ? null : errorText || null,
            requestId,
            edgeStatus,
            attemptedAt: Date.now(),
          },
        }));
      } catch (e) {
        setPreviewDiagnostics((prev) => ({
          ...prev,
          [input.fileId]: {
            ok: false,
            status: 0,
            contentType: null,
            bytes: 0,
            errorText: e instanceof Error ? e.message : String(e),
            requestId: null,
            edgeStatus: null,
            attemptedAt: Date.now(),
          },
        }));
      } finally {
        setPreviewDiagnosticsPending((prev) => ({ ...prev, [input.fileId]: false }));
      }
    },
    [],
  );

  const lastAutoPreviewKeyRef = useRef<string | null>(null);
  useEffect(() => {
    // Auto-warm preview only after upload has completed, and only when selection changes.
    if (!selectedPart) return;
    if (selectedUploadStatus !== "uploaded") return;
    if (!selectedUploadedRef?.token) return;
    if (!selectedPreviewUrl) return;

    const key = `${selectedPart.id}:${selectedUploadedRef.token}:${selectedCadKind ?? "unknown"}`;
    if (lastAutoPreviewKeyRef.current === key) return;
    lastAutoPreviewKeyRef.current = key;

    void runPreviewTest({ fileId: selectedPart.id, previewUrl: selectedPreviewUrl });
  }, [
    runPreviewTest,
    selectedCadKind,
    selectedPart,
    selectedPreviewUrl,
    selectedUploadStatus,
    selectedUploadedRef?.token,
  ]);

  const pingPreviewApi = useCallback(async () => {
    setPingPending(true);
    setPingResult(null);
    try {
      const res = await fetch("/api/cad-preview", { cache: "no-store" });
      const text = await res.text().catch(() => "");
      setPingResult({
        status: res.status,
        text: (text || "").slice(0, 500),
        attemptedAt: Date.now(),
      });
    } catch (e) {
      setPingResult({
        status: 0,
        text: e instanceof Error ? e.message : String(e),
        attemptedAt: Date.now(),
      });
    } finally {
      setPingPending(false);
    }
  }, []);

  const forceFetchPreviewNow = useCallback(async () => {
    const previewUrl = selectedPreviewUrl;
    console.log("[cad-preview] force-fetch", { previewUrl });
    setForceFetchPending(true);
    setForceFetchResult(null);
    try {
      if (!previewUrl) {
        setForceFetchResult({
          status: 0,
          text: "previewUrl is missing (need uploaded file + preview token + cadKind).",
          attemptedAt: Date.now(),
        });
        return;
      }
      const res = await fetch(previewUrl, { cache: "no-store" });
      const text = await res.text().catch(() => "");
      setForceFetchResult({
        status: res.status,
        text: (text || "").slice(0, 500),
        attemptedAt: Date.now(),
      });
    } catch (e) {
      setForceFetchResult({
        status: 0,
        text: e instanceof Error ? e.message : String(e),
        attemptedAt: Date.now(),
      });
    } finally {
      setForceFetchPending(false);
    }
  }, [selectedPreviewUrl]);

  const testStorageUploadPermissions = useCallback(async () => {
    setPermissionTestPending(true);
    setPermissionTestResult(null);
    try {
      const bucket = uploadBucketId ?? "cad_uploads";
      const sb = supabaseBrowser();
      const userId = await sb.auth
        .getUser()
        .then((res) => res.data.user?.id ?? null)
        .catch(() => null);
      if (!userId) {
        setPermissionTestResult({
          status: 401,
          text: "No Supabase user session in browser (sign in required).",
          attemptedAt: Date.now(),
        });
        return;
      }
      const suffix =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID().slice(0, 8)
          : Math.random().toString(16).slice(2, 10);
      const path = `uploads/intake/${userId}/permission-test/${Date.now()}-${suffix}.txt`;
      const blob = new Blob(["x"], { type: "text/plain" });

      console.log("[intake] storage permission test start", { bucket, path });
      const { error: uploadError } = await sb.storage.from(bucket).upload(path, blob, {
        cacheControl: "60",
        upsert: false,
        contentType: "text/plain",
      });

      if (uploadError) {
        const message =
          typeof (uploadError as any)?.message === "string"
            ? String((uploadError as any).message)
            : "upload_failed";
        console.error("[intake] storage permission test failed", uploadError);
        setPermissionTestResult({
          status: 0,
          text: `Upload failed: ${message}`,
          attemptedAt: Date.now(),
        });
        return;
      }

      const proof = await (async () => {
        const qs = new URLSearchParams();
        qs.set("bucket", bucket);
        qs.set("path", path);
        const url = `/api/storage-proof?${qs.toString()}`;
        const res = await fetch(url, { cache: "no-store" });
        const text = await res.text().catch(() => "");
        const json = (() => {
          try {
            return JSON.parse(text);
          } catch {
            return null;
          }
        })();
        return { res, json, text, url };
      })();

      setPermissionTestResult({
        status: 200,
        text: `Uploaded ok. Proof: ${proof.res.status} ${(proof.json as any)?.exists === true ? "exists" : "missing/error"}. bucket=${bucket} path=${path}`,
        attemptedAt: Date.now(),
      });
    } catch (e) {
      setPermissionTestResult({
        status: 0,
        text: e instanceof Error ? e.message : String(e),
        attemptedAt: Date.now(),
      });
    } finally {
      setPermissionTestPending(false);
    }
  }, [uploadBucketId]);

  const selectedGeometryStats = selectedPart
    ? geometryStatsMap[selectedPart.id] ?? null
    : null;
  const handleGeometryStatsUpdate = useCallback(
    (fileId: string | null, stats: GeometryStats | null) => {
      if (!fileId) {
        return;
      }
      setGeometryStatsMap((prev) => {
        if (prev[fileId] === stats) {
          return prev;
        }
        return { ...prev, [fileId]: stats };
      });
    },
    [],
  );
  const viewerGeometryHandler = useMemo(
    () =>
      (stats: GeometryStats | null) =>
        handleGeometryStatsUpdate(selectedPart?.id ?? null, stats),
    [handleGeometryStatsUpdate, selectedPart?.id],
  );

  const clearFieldError = useCallback((field: FieldErrorKey) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const ingestFiles = useCallback(
    (candidates: File[]) => {
      if (!candidates || candidates.length === 0) {
        return;
      }

      const tooLarge = candidates.filter((file) => isFileTooLarge(file));
      const sizeWarning =
        tooLarge.length > 0
          ? `Some files are too large to upload (max ${MAX_UPLOAD_SIZE_LABEL} per file). Try splitting your ZIP or compressing large drawings.`
          : null;

      const accepted: File[] = [];
      const rejectionMessages: string[] = [];

      candidates
        .filter((file) => !isFileTooLarge(file))
        .forEach((file) => {
        const validationError = validateCadFile(file);
        if (validationError) {
          rejectionMessages.push(`${file.name}: ${validationError}`);
          return;
        }
        accepted.push(file);
      });

      if (accepted.length === 0 && (sizeWarning || rejectionMessages.length > 0)) {
        const combined = [sizeWarning, rejectionMessages.join(" ")]
          .filter(Boolean)
          .join(" ");
        setError(combined || QUOTE_INTAKE_FALLBACK_ERROR);
        setFieldErrors((prev) => ({
          ...prev,
          file: combined || "Some selected files could not be uploaded.",
        }));
        return;
      }

      setState((prev) => {
        const existingKeys = new Set(
          prev.files.map((entry) => buildFileKey(entry.file)),
        );
        const nextFiles = [...prev.files];
        for (const file of accepted) {
          if (nextFiles.length >= MAX_FILES_PER_RFQ) {
            rejectionMessages.push(
              `Reached the ${MAX_FILES_PER_RFQ}-file limit. Remove a file before adding more.`,
            );
            break;
          }
          const key = buildFileKey(file);
          if (existingKeys.has(key)) {
            continue;
          }
          const entry = createSelectedCadFile(file);
          nextFiles.push(entry);
          existingKeys.add(key);
        }

        const nextSelectedId =
          prev.selectedFileId ??
          (nextFiles.length > 0 ? nextFiles[0].id : null);

        return {
          ...prev,
          files: nextFiles,
          selectedFileId: nextSelectedId,
        };
      });

      const combinedBanner = [sizeWarning, rejectionMessages.join(" ")]
        .filter(Boolean)
        .join(" ");
      if (combinedBanner.length > 0) {
        setError(combinedBanner);
      } else {
        setError(null);
        clearFieldError("file");
      }
      setSuccessMessage(null);
    },
    [clearFieldError],
  );

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

    try {
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) {
        return;
      }
      ingestFiles(files);
      const target = e.target;
      if (target instanceof HTMLInputElement) {
        target.value = "";
      }
    } catch (dropError) {
      console.error("[quote intake] client drop failed", dropError);
      setError(QUOTE_INTAKE_FALLBACK_ERROR);
      setSuccessMessage(null);
    }
  };

  const handleRemovePart = useCallback(
    (fileId: string) => {
      setState((prev) => {
        const target = prev.files.find((entry) => entry.id === fileId);
        if (!target) {
          return prev;
        }
        disposeSelectedCadFiles(target);
        const nextFiles = prev.files.filter((entry) => entry.id !== fileId);
        const nextSelectedId =
          prev.selectedFileId && prev.selectedFileId !== fileId
            ? prev.selectedFileId
            : nextFiles[0]?.id ?? null;

        return {
          ...prev,
          files: nextFiles,
          selectedFileId: nextSelectedId,
        };
      });
      setGeometryStatsMap((prev) => {
        if (!(fileId in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[fileId];
        return next;
      });
      setUploadedRefs((prev) => {
        if (!(fileId in prev)) return prev;
        const next = { ...prev };
        delete next[fileId];
        return next;
      });
      setUploadProgress((prev) => {
        if (!(fileId in prev)) return prev;
        const next = { ...prev };
        delete next[fileId];
        return next;
      });
      setUploadTargets((prev) => {
        if (!(fileId in prev)) return prev;
        const next = { ...prev };
        delete next[fileId];
        return next;
      });
      setStorageProof((prev) => {
        if (!(fileId in prev)) return prev;
        const next = { ...prev };
        delete next[fileId];
        return next;
      });
      setPreviewDiagnostics((prev) => {
        if (!(fileId in prev)) return prev;
        const next = { ...prev };
        delete next[fileId];
        return next;
      });
      setPreviewDiagnosticsPending((prev) => {
        if (!(fileId in prev)) return prev;
        const next = { ...prev };
        delete next[fileId];
        return next;
      });
    },
    [setGeometryStatsMap],
  );

  const handleSelectPart = useCallback((fileId: string) => {
    setState((prev) => {
      if (prev.selectedFileId === fileId) {
        return prev;
      }
      if (!prev.files.some((entry) => entry.id === fileId)) {
        return prev;
      }
      return { ...prev, selectedFileId: fileId };
    });
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    ingestFiles(files);
    event.target.value = "";
  };

  type InputFieldKey =
    | "firstName"
    | "lastName"
    | "email"
    | "company"
    | "phone"
    | "manufacturingProcess"
    | "quantity"
    | "shippingPostalCode"
    | "exportRestriction"
    | "rfqReason"
    | "notes";

  const handleInputChange =
    (field: InputFieldKey) =>
    (
      e:
        | ChangeEvent<HTMLInputElement>
        | ChangeEvent<HTMLTextAreaElement>
        | ChangeEvent<HTMLSelectElement>,
    ) => {
      if (contactFieldLockSet?.has(field)) {
        return;
      }
      const value = e.target.value;
      setState((prev) => ({ ...prev, [field]: value }));
      if (field in fieldErrors) {
        clearFieldError(field as FieldErrorKey);
      }
      setSuccessMessage(null);
    };

  const handleCheckboxChange =
    (field: "itarAcknowledged" | "termsAccepted") =>
    (e: ChangeEvent<HTMLInputElement>) => {
      const checked = e.target.checked;
      setState((prev) => ({ ...prev, [field]: checked }));
      clearFieldError(field);
      setSuccessMessage(null);
    };

  const ensureUploadSessionId = useCallback((): string => {
    const existing = uploadSessionIdRef.current;
    if (existing) return existing;
    const next =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().replace(/-/g, "")
        : `${Date.now().toString(36)}${Math.random().toString(16).slice(2)}`;
    uploadSessionIdRef.current = next;
    return next;
  }, []);

  const uploadInFlightRef = useRef<Set<string>>(new Set());

  const runStorageProof = useCallback(
    async (input: { fileId: string; bucket: string; path: string }) => {
      setStorageProof((prev) => ({ ...prev, [input.fileId]: { status: "checking" } }));
      try {
        const qs = new URLSearchParams();
        qs.set("bucket", input.bucket);
        qs.set("path", input.path);
        const url = `/api/storage-proof?${qs.toString()}`;
        const res = await fetch(url, { cache: "no-store" });
        const text = await res.text().catch(() => "");
        const parsed = (() => {
          try {
            return JSON.parse(text) as any;
          } catch {
            return null;
          }
        })();

        if (!res.ok) {
          console.error("[storage-proof] failed", {
            url,
            status: res.status,
            text: (text || "").slice(0, 500),
          });
          if (res.status === 404 && parsed && parsed.exists === false) {
            setStorageProof((prev) => ({
              ...prev,
              [input.fileId]: { status: "missing", url, httpStatus: res.status, raw: (text || "").slice(0, 500) },
            }));
            return { ok: false as const, reason: "missing" };
          }
          const reason =
            (parsed && typeof parsed.error === "string" && parsed.error.trim()) ||
            `storage_proof_http_${res.status}`;
          setStorageProof((prev) => ({
            ...prev,
            [input.fileId]: {
              status: "failed",
              errorReason: reason,
              url,
              httpStatus: res.status,
              raw: (text || "").slice(0, 500),
            },
          }));
          return { ok: false as const, reason };
        }

        const exists = Boolean(parsed && parsed.exists === true);
        const bytes =
          parsed && typeof parsed.bytes === "number" && Number.isFinite(parsed.bytes)
            ? Number(parsed.bytes)
            : null;
        if (!exists) {
          setStorageProof((prev) => ({
            ...prev,
            [input.fileId]: { status: "missing", url, httpStatus: res.status, raw: (text || "").slice(0, 500) },
          }));
          return { ok: false as const, reason: "missing" };
        }
        setStorageProof((prev) => ({
          ...prev,
          [input.fileId]: { status: "ok", bytes, url, httpStatus: res.status, raw: (text || "").slice(0, 500) },
        }));
        return { ok: true as const, bytes };
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        setStorageProof((prev) => ({
          ...prev,
          [input.fileId]: {
            status: "failed",
            errorReason: reason,
            url: "fetch_exception",
            httpStatus: 0,
            raw: null,
          },
        }));
        return { ok: false as const, reason };
      }
    },
    [],
  );

  const runProofCanary = useCallback(async () => {
    setProofCanaryPending(true);
    setProofCanaryResult(null);
    try {
      const bucket = "cad_uploads";
      const sb = supabaseBrowser();
      const userId = await sb.auth
        .getUser()
        .then((res) => res.data.user?.id ?? null)
        .catch(() => null);
      if (!userId) {
        setProofCanaryResult({
          upload: { ok: false, errorText: "not_authenticated", bucket, path: "" },
          proof: { ok: false, status: 401, text: "not_authenticated" },
          attemptedAt: Date.now(),
        });
        return;
      }

      const path = `uploads/intake/${userId}/__canary__.txt`;
      const blob = new Blob(["x"], { type: "text/plain" });

      // Make it repeatable without requiring UPDATE policies: delete then insert.
      await sb.storage.from(bucket).remove([path]).catch(() => undefined);
      const { error: uploadError } = await sb.storage.from(bucket).upload(path, blob, {
        cacheControl: "60",
        upsert: false,
        contentType: "text/plain",
      });

      const uploadOk = !uploadError;
      const uploadErrorText =
        uploadError && typeof (uploadError as any)?.message === "string"
          ? String((uploadError as any).message)
          : uploadError
            ? "upload_failed"
            : null;

      const qs = new URLSearchParams();
      qs.set("bucket", bucket);
      qs.set("path", path);
      const url = `/api/storage-proof?${qs.toString()}`;
      const res = await fetch(url, { cache: "no-store" });
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        console.error("[storage-proof] failed", {
          url,
          status: res.status,
          text: (text || "").slice(0, 500),
        });
      }

      setProofCanaryResult({
        upload: { ok: uploadOk, errorText: uploadErrorText, bucket, path },
        proof: { ok: res.ok, status: res.status, text: (text || "").slice(0, 500) },
        attemptedAt: Date.now(),
      });
    } catch (e) {
      setProofCanaryResult({
        upload: { ok: false, errorText: e instanceof Error ? e.message : String(e), bucket: "cad_uploads", path: "" },
        proof: { ok: false, status: 0, text: e instanceof Error ? e.message : String(e) },
        attemptedAt: Date.now(),
      });
    } finally {
      setProofCanaryPending(false);
    }
  }, []);

  const startUploadForEntry = useCallback(
    async (entry: SelectedCadFile) => {
      const fileId = entry.id;
      if (uploadInFlightRef.current.has(fileId)) return;
      if (uploadedRefs[fileId]) return;
      if (uploadProgress[fileId]?.status === "uploading") return;
      if (uploadProgress[fileId]?.status === "failed") return;

      uploadInFlightRef.current.add(fileId);

      const file = entry.file;
      console.log("[intake-upload] start", { fileName: file.name, size: file.size, type: file.type });

      try {
        setUploadProgress((prev) => ({ ...prev, [fileId]: { status: "uploading" } }));
        setStorageProof((prev) => ({ ...prev, [fileId]: { status: "unknown" } }));

        const sessionId = ensureUploadSessionId();
        const prepareData = new FormData();
        prepareData.set("sessionId", sessionId);
        prepareData.set(
          "filesMeta",
          JSON.stringify([
            {
              clientFileId: fileId,
              fileName: file.name,
              sizeBytes: file.size,
              mimeType: file.type || null,
            },
          ]),
        );

        const prepared = await prepareQuoteIntakeEphemeralUploadAction(prepareData);
        if (!prepared.ok) {
          const message = prepared.error || QUOTE_INTAKE_FALLBACK_ERROR;
          console.error("[intake-upload] failed", { step: "prepare", message, err: prepared });
          setUploadProgress((prev) => ({
            ...prev,
            [fileId]: { status: "failed", errorReason: message, step: "prepare" },
          }));
          setError(message);
          setSuccessMessage(null);
          return;
        }

        const target = prepared.targets.find((t) => t.clientFileId === fileId) ?? null;
        if (!target) {
          const diagnostic = "Missing upload target.";
          const message = "We couldn’t start the upload. Please try again.";
          console.error("[intake-upload] failed", { step: "prepare", message: diagnostic, err: prepared });
          setUploadProgress((prev) => ({
            ...prev,
            [fileId]: { status: "failed", errorReason: message, step: "prepare" },
          }));
          setError(message);
          setSuccessMessage(null);
          return;
        }

        setUploadBucketId((prev) => prev ?? prepared.uploadBucketId);
        setUploadTargets((prev) => ({ ...prev, [fileId]: target }));

        const sb = supabaseBrowser();
        const session = await sb.auth.getSession().then((res) => res.data.session).catch(() => null);
        console.log("[intake-upload] bucket/path", {
          bucket: target.bucketId,
          path: target.storagePath,
          hasSession: Boolean(session),
        });
        console.log("[intake-upload] prepared", {
          bucket: target.bucketId,
          path: target.storagePath,
          hasToken: Boolean(target.previewToken),
          userId: prepared.userId,
          target: true,
        });

        console.log("[intake-upload] uploading", { bucket: target.bucketId, path: target.storagePath });
        const { error: uploadError } = await sb.storage.from(target.bucketId).upload(target.storagePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: target.mimeType || file.type || "application/octet-stream",
        });

        if (uploadError) {
          const formatted = formatStorageUploadError({
            error: uploadError,
            bucket: target.bucketId,
            path: target.storagePath,
          });
          console.error("[intake-upload] failed", { step: "upload", message: formatted, err: uploadError });
          setUploadProgress((prev) => ({
            ...prev,
            [fileId]: { status: "failed", errorReason: formatted, step: "upload" },
          }));
          setError(formatted);
          setSuccessMessage(null);
          return;
        }

        console.log("[intake-upload] uploaded", { bucket: target.bucketId, path: target.storagePath });

        const proof = await runStorageProof({ fileId, bucket: target.bucketId, path: target.storagePath });
        if (!proof.ok) {
          const userMessage =
            "Upload completed, but we couldn’t confirm it yet. Please try again.";
          console.error("[intake-upload] failed", { step: "proof", reason: proof.reason, err: proof });
          setUploadProgress((prev) => ({
            ...prev,
            [fileId]: { status: "failed", errorReason: userMessage, step: "proof" },
          }));
          setError(userMessage);
          setSuccessMessage(null);
          return;
        }

        setUploadedRefs((prev) => ({
          ...prev,
          [fileId]: { bucket: target.bucketId, path: target.storagePath, token: target.previewToken },
        }));
        setUploadProgress((prev) => ({ ...prev, [fileId]: { status: "uploaded" } }));

        // Make the newly uploaded file the active preview target.
        setState((prev) =>
          prev.selectedFileId === fileId ? prev : { ...prev, selectedFileId: fileId },
        );
      } catch (e) {
        const diagnostic = e instanceof Error ? e.message : String(e);
        const message = "We couldn’t upload this file. Please try again.";
        console.error("[intake-upload] failed", { step: "upload", message: diagnostic, err: e });
        setUploadProgress((prev) => ({
          ...prev,
          [fileId]: { status: "failed", errorReason: message, step: "upload" },
        }));
        setError(message);
        setSuccessMessage(null);
      } finally {
        uploadInFlightRef.current.delete(fileId);
      }
    },
    [
      ensureUploadSessionId,
      runStorageProof,
      uploadProgress,
      uploadedRefs,
      setUploadedRefs,
      setUploadProgress,
      setError,
      setSuccessMessage,
    ],
  );

  useEffect(() => {
    // Auto-upload on selection: enqueue any files that aren't uploaded/failed yet.
    for (const entry of state.files) {
      const fileId = entry.id;
      const progress = uploadProgress[fileId]?.status ?? (uploadedRefs[fileId] ? "uploaded" : "idle");
      if (progress === "idle") {
        void startUploadForEntry(entry);
      }
    }
  }, [startUploadForEntry, state.files, uploadProgress, uploadedRefs]);

  useEffect(() => {
    if (!uploadBucketId) return;
    console.log("[intake] upload bucket", { uploadBucketId });
  }, [uploadBucketId]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    try {
      e.preventDefault();
      if (isSubmitting) return;
      setError(null);
      setSuccessMessage(null);

      const validationErrors = validateFormFields(state);
      if (hasErrors(validationErrors)) {
        setFieldErrors(validationErrors);
        setError("Please fix the highlighted fields before submitting.");
        return;
      }

      if (!allFilesUploaded) {
        setError("Uploads are still in progress (or failed). Please wait for all files to show “Uploaded”.");
        return;
      }

      const orderedTargets = state.files
        .map((entry) => uploadTargets[entry.id] ?? null)
        .filter((t): t is QuoteIntakeEphemeralUploadTarget => Boolean(t));

      if (orderedTargets.length !== state.files.length) {
        setError("Missing upload targets for one or more files. Please re-add the file(s) and retry.");
        return;
      }

      setIsSubmitting(true);
      const form = e.currentTarget;
      const formData = new FormData(form);
      formData.delete("files");
      formData.set(
        "targets",
        JSON.stringify(
          orderedTargets.map((t) => ({
            storagePath: t.storagePath,
            bucketId: t.bucketId,
            fileName: t.fileName,
            mimeType: t.mimeType,
            sizeBytes: t.sizeBytes,
          })),
        ),
      );

      console.log("[intake-upload] finalize start", { fileCount: orderedTargets.length });
      const finalized = await finalizeQuoteIntakeEphemeralUploadAction(formData);
      if (!finalized.ok) {
        console.error("[intake-upload] failed", { step: "finalize", message: finalized.error, err: finalized });
        setError(finalized.error || QUOTE_INTAKE_FALLBACK_ERROR);
        setSuccessMessage(null);
        return;
      }
      setError(null);
      setSuccessMessage(finalized.message || "RFQ received.");
      setFieldErrors({});
      resetUploadState();
    } catch (e) {
      console.error("[intake-upload] failed", { step: "finalize", message: "unexpected error", err: e });
      setError(QUOTE_INTAKE_FALLBACK_ERROR);
      setSuccessMessage(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section
      aria-label="Upload CAD file"
      className="relative flex flex-col rounded-3xl border border-border bg-surface p-6 sm:p-8"
    >
      <form
        onSubmit={handleSubmit}
        className="flex flex-col"
        noValidate
      >
        {successMessage && (
          <div className="mb-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {successMessage}
          </div>
        )}
        {error && (
          <div className="mb-4 whitespace-pre-wrap rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}
        {showExplainer ? (
          <div className="mb-6 rounded-2xl border border-white/5 bg-white/5 p-4 text-left shadow-[0_10px_30px_rgba(2,6,23,0.45)]">
            <p className="text-sm font-semibold text-foreground heading-tight">
              What happens when you submit an RFQ?
            </p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              {UPLOAD_EXPLAINER_POINTS.map((point) => (
                <li key={point} className="flex gap-2">
                  <span
                    className="mt-2 h-1.5 w-1.5 rounded-full bg-accent"
                    aria-hidden="true"
                  />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
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
            {CAD_FILE_TYPE_DESCRIPTION}. Drag in up to {MAX_FILES_PER_RFQ} files.
          </p>
          <p className="mt-1 text-xs text-muted">
            Max {MAX_UPLOAD_SIZE_LABEL} per file (including ZIPs). For larger packages, split into multiple ZIPs.
          </p>
          <div className="mt-4 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center rounded-full border border-slate-300/40 px-6 py-2 text-sm font-semibold text-slate-50 hover:bg-slate-100/5"
            >
              Browse from device
            </button>
            <p className="text-[11px] text-muted">
              …or drag &amp; drop files into this box
            </p>
            <p className="mt-1 text-[11px] text-muted">
              {state.files.length === 0
                ? "No files attached yet"
                : `${state.files.length} file${state.files.length === 1 ? "" : "s"} attached`}
            </p>
            <p className="mt-3 text-[11px] text-muted">
              Your CAD files and drawings stay private. We only share them with matched suppliers for quoting.
            </p>
          </div>
          <input
            id="files"
            name="files"
            type="file"
            multiple
            className="hidden"
            onChange={handleFileChange}
            accept={fileInputAccept}
            ref={fileInputRef}
          />
          {fieldErrors.file && (
            <p className="mt-3 text-xs text-red-400" role="alert">
              {fieldErrors.file}
            </p>
          )}
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-5">
          <div className="rounded-2xl border border-white/5 bg-white/5 p-4 text-left shadow-[0_10px_30px_rgba(2,6,23,0.45)] lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Parts in this RFQ
                </p>
                <p className="text-sm text-foreground">
                  {state.files.length === 0
                    ? "Attach CAD to start quoting multiple parts."
                    : "Click to set the primary preview + DFM target."}
                </p>
              </div>
              <span className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {state.files.length} / {MAX_FILES_PER_RFQ}
              </span>
            </div>
            <div className="mt-4 space-y-2">
              {state.files.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border/60 px-4 py-3 text-sm text-muted">
                  Drop multiple STEP/STL files above. All files stay on the same RFQ.
                </p>
              ) : (
                state.files.map((entry, index) => {
                  const isSelected = selectedPart?.id === entry.id;
                  const uploaded = Boolean(uploadedRefs[entry.id]);
                  const previewRef = uploadedRefs[entry.id] ?? null;
                  const progress =
                    uploadProgress[entry.id]?.status ?? (uploaded ? "uploaded" : "idle");
                  const isPreviewing = Boolean(isSelected && uploaded);
                  if (isPreviewing && progress !== "uploaded") {
                    console.warn("[uploadbox] invalid state: previewing before uploaded", entry);
                  }
                  const kindInfo = classifyCadFileType({
                    filename: entry.file.name,
                    extension: null,
                  });
                  const cadKind = kindInfo.ok ? kindInfo.type : null;
                  return (
                    <div
                      key={entry.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectPart(entry.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleSelectPart(entry.id);
                        }
                      }}
                      className={clsx(
                        "flex cursor-pointer items-start justify-between rounded-xl border px-4 py-3 transition",
                        isSelected
                          ? "border-accent/70 bg-accent/5"
                          : "border-border/60 bg-black/20 hover:border-border",
                      )}
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-xs uppercase tracking-wide text-muted">{`Part ${index + 1}`}</p>
                        <p className="truncate text-sm font-semibold text-foreground">
                          {entry.file.name}
                        </p>
                        <p className="text-xs text-muted">
                          {formatReadableBytes(entry.file.size)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {uploaded && previewRef ? (
                          <>
                            {cadKind ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setPreviewOpenForId(entry.id);
                                }}
                                className="rounded-full border border-border/60 px-2 py-1 text-[11px] text-slate-100 transition hover:border-border"
                                title="Preview in 3D (loads from server)"
                              >
                                Preview 3D
                              </button>
                            ) : null}
                            <span className="text-[10px] font-semibold text-emerald-200">
                              Uploaded
                            </span>
                          </>
                        ) : (
                          <span className="text-[10px] text-muted">
                            {progress === "uploading"
                              ? "Uploading…"
                              : progress === "failed"
                                ? `Couldn’t upload: ${
                                    (uploadProgress[entry.id] as
                                      | { status: "failed"; errorReason: string }
                                      | undefined)?.errorReason ?? "Unknown error"
                                  }`
                                : "Queued…"}
                          </span>
                        )}
                        <span
                          className={clsx(
                            "pill text-[10px] font-semibold uppercase tracking-wide",
                            isPreviewing ? "pill-info" : "pill-muted",
                          )}
                        >
                          {isPreviewing
                            ? "Previewing"
                            : progress === "uploading"
                              ? "Uploading"
                              : progress === "failed"
                                ? "Failed"
                                : uploaded
                                  ? "Uploaded"
                                  : "Queued"}
                        </span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleRemovePart(entry.id);
                          }}
                          disabled={isSubmitting || uploaded}
                          className="rounded-full border border-border/60 px-2 py-1 text-[11px] text-muted transition hover:border-red-400/60 hover:text-red-200"
                          aria-label={`Remove ${entry.file.name}`}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div className="space-y-4 lg:col-span-3">
            {selectedPart && selectedUploadStatus !== "uploaded" ? (
              <div className="rounded-2xl border border-white/5 bg-white/5 p-6 text-left shadow-[0_10px_30px_rgba(2,6,23,0.45)]">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Preview pending upload
                </div>
                <p className="mt-2 text-sm text-slate-200">
                  {selectedUploadStatus === "uploading"
                    ? "Uploading…"
                    : selectedUploadStatus === "failed"
                      ? `Couldn’t upload: ${
                          (uploadProgress[selectedPart.id] as
                            | { status: "failed"; errorReason: string }
                            | undefined)?.errorReason ?? "Unknown error"
                        }`
                      : "Waiting to start upload…"}
                </p>
                <p className="mt-2 text-xs text-muted">
                  We’ll start 3D preview + DFM after we confirm the upload.
                </p>
              </div>
            ) : selectedPart && selectedUploadedRef?.token && selectedCadKind ? (
              <>
                <ThreeCadViewer
                  storageSource={{
                    bucket: selectedUploadedRef.bucket,
                    path: selectedUploadedRef.path,
                    token: selectedUploadedRef.token,
                  }}
                  filenameHint={selectedPart.file.name}
                  cadKind={selectedCadKind}
                />
                <PartDfMPanel
                  geometryStats={selectedGeometryStats}
                  process={state.manufacturingProcess}
                  quantityHint={state.quantity}
                  targetDate={null}
                  className="bg-white/5"
                />
              </>
            ) : (
              <CadViewerPanel
                file={null}
                fileName={selectedPart?.file.name}
                fallbackMessage="Select a CAD file to preview it in 3D."
                onGeometryStats={viewerGeometryHandler}
              />
            )}
            <details className="rounded-2xl border border-white/5 bg-white/5 p-4 text-left shadow-[0_10px_30px_rgba(2,6,23,0.45)]">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">
                Preview diagnostics
              </summary>
              <div className="mt-4 space-y-3 text-xs text-slate-200">
                {selectedPart ? (
                  <>
                    <div className="grid gap-2 md:grid-cols-2">
                      <div>
                        <div className="text-[11px] text-muted">uploadBucketId (configured)</div>
                        <div className="break-all text-slate-100">{uploadBucketId ?? "—"}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted">filename</div>
                        <div className="break-all text-slate-100">{selectedPart.file.name}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted">cadKind</div>
                        <div className="text-slate-100">{selectedCadKind ?? "unknown"}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted">bucket</div>
                        <div className="break-all text-slate-100">
                          {selectedUploadedRef?.bucket ?? "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted">path</div>
                        <div className="break-all text-slate-100">
                          {selectedUploadedRef?.path ?? "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted">storageProof</div>
                        <div className="text-slate-100">
                          {selectedStorageProof?.status === "ok"
                            ? `ok${typeof selectedStorageProof.bytes === "number" ? ` (${selectedStorageProof.bytes} bytes)` : ""}`
                            : selectedStorageProof?.status ?? "—"}
                        </div>
                      </div>
                      <div className="md:col-span-2">
                        <div className="text-[11px] text-muted">storageProof details</div>
                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-white/5 bg-black/30 p-2 text-[11px] text-slate-100">
                          {(() => {
                            if (!selectedStorageProof || selectedStorageProof.status === "unknown") return "—";
                            if (selectedStorageProof.status === "checking") return "checking…";
                            const common = `httpStatus=${(selectedStorageProof as any).httpStatus} url=${(selectedStorageProof as any).url}`;
                            if (selectedStorageProof.status === "ok") {
                              return `${common}\nbytes=${String(selectedStorageProof.bytes ?? "null")}\nraw=${(selectedStorageProof.raw ?? "—").slice(0, 500)}`;
                            }
                            if (selectedStorageProof.status === "missing") {
                              return `${common}\nraw=${(selectedStorageProof.raw ?? "—").slice(0, 500)}`;
                            }
                            return `${common}\nerrorReason=${(selectedStorageProof as any).errorReason}\nraw=${(selectedStorageProof as any).raw ?? "—"}`;
                          })()}
                        </pre>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted">previewToken present?</div>
                        <div className="text-slate-100">
                          {selectedUploadedRef?.token ? "yes" : "no"}
                        </div>
                      </div>
                      <div className="md:col-span-2">
                        <div className="text-[11px] text-muted">previewUrl</div>
                        <div className="break-all text-slate-100">
                          {selectedPreviewUrl ?? "—"}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void pingPreviewApi()}
                        disabled={pingPending}
                        className={clsx(
                          "rounded-full border border-border/60 bg-black/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-100 transition hover:border-border",
                          pingPending && "opacity-60",
                        )}
                      >
                        {pingPending ? "Pinging…" : "Ping /api/cad-preview (expect 400)"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!selectedPreviewUrl || !selectedPart) return;
                          void runPreviewTest({ fileId: selectedPart.id, previewUrl: selectedPreviewUrl });
                        }}
                        disabled={!selectedPreviewUrl || selectedPreviewDiagnosticsPending}
                        className={clsx(
                          "rounded-full border border-border/60 bg-black/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-100 transition hover:border-border",
                          (!selectedPreviewUrl || selectedPreviewDiagnosticsPending) && "opacity-60",
                        )}
                      >
                        {selectedPreviewDiagnosticsPending ? "Running…" : "Run preview test"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void forceFetchPreviewNow()}
                        disabled={forceFetchPending}
                        className={clsx(
                          "rounded-full border border-border/60 bg-black/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-100 transition hover:border-border",
                          forceFetchPending && "opacity-60",
                        )}
                      >
                        {forceFetchPending ? "Fetching…" : "Force preview fetch now"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void testStorageUploadPermissions()}
                        disabled={permissionTestPending}
                        className={clsx(
                          "rounded-full border border-border/60 bg-black/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-100 transition hover:border-border",
                          permissionTestPending && "opacity-60",
                        )}
                      >
                        {permissionTestPending ? "Testing…" : "Test Storage upload permissions"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void runProofCanary()}
                        disabled={proofCanaryPending}
                        className={clsx(
                          "rounded-full border border-border/60 bg-black/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-100 transition hover:border-border",
                          proofCanaryPending && "opacity-60",
                        )}
                      >
                        {proofCanaryPending ? "Running…" : "Run proof canary"}
                      </button>
                    </div>

                    {(pingResult || forceFetchResult || permissionTestResult || proofCanaryResult) ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                            ping /api/cad-preview result
                          </div>
                          {pingResult ? (
                            <div className="mt-2 space-y-2">
                              <div className="text-[11px] text-muted">status</div>
                              <div className="text-slate-100">{pingResult.status}</div>
                              <div className="text-[11px] text-muted">body (first 500 chars)</div>
                              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-white/5 bg-black/30 p-2 text-[11px] text-slate-100">
                                {pingResult.text || "—"}
                              </pre>
                            </div>
                          ) : (
                            <div className="mt-2 text-[11px] text-muted">No ping yet.</div>
                          )}
                        </div>
                        <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                            force preview fetch result
                          </div>
                          <div className="mt-2 space-y-2">
                            <div className="text-[11px] text-muted">previewUrl</div>
                            <div className="break-all text-slate-100">{selectedPreviewUrl ?? "—"}</div>
                            {forceFetchResult ? (
                              <>
                                <div className="text-[11px] text-muted">status</div>
                                <div className="text-slate-100">{forceFetchResult.status}</div>
                                <div className="text-[11px] text-muted">body (first 500 chars)</div>
                                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-white/5 bg-black/30 p-2 text-[11px] text-slate-100">
                                  {forceFetchResult.text || "—"}
                                </pre>
                              </>
                            ) : (
                              <div className="text-[11px] text-muted">No force fetch yet.</div>
                            )}
                          </div>
                        </div>
                        <div className="rounded-xl border border-white/5 bg-black/20 p-3 md:col-span-2">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                            storage permissions test
                          </div>
                          {permissionTestResult ? (
                            <div className="mt-2 space-y-2">
                              <div className="text-[11px] text-muted">status</div>
                              <div className="text-slate-100">{permissionTestResult.status}</div>
                              <div className="text-[11px] text-muted">result</div>
                              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-white/5 bg-black/30 p-2 text-[11px] text-slate-100">
                                {permissionTestResult.text || "—"}
                              </pre>
                            </div>
                          ) : (
                            <div className="mt-2 text-[11px] text-muted">No test yet.</div>
                          )}
                        </div>
                        <div className="rounded-xl border border-white/5 bg-black/20 p-3 md:col-span-2">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                            proof canary
                          </div>
                          {proofCanaryResult ? (
                            <div className="mt-2 space-y-2">
                              <div className="text-[11px] text-muted">upload</div>
                              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-white/5 bg-black/30 p-2 text-[11px] text-slate-100">
                                {JSON.stringify(proofCanaryResult.upload, null, 2)}
                              </pre>
                              <div className="text-[11px] text-muted">proof</div>
                              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-white/5 bg-black/30 p-2 text-[11px] text-slate-100">
                                {JSON.stringify(proofCanaryResult.proof, null, 2)}
                              </pre>
                            </div>
                          ) : (
                            <div className="mt-2 text-[11px] text-muted">No canary run yet.</div>
                          )}
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                        last preview attempt result
                      </div>
                      {selectedPreviewDiagnostics ? (
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          <div>
                            <div className="text-[11px] text-muted">status</div>
                            <div className="text-slate-100">
                              {selectedPreviewDiagnostics.status}
                              {selectedPreviewDiagnostics.ok ? " (ok)" : " (error)"}
                            </div>
                          </div>
                          {selectedPreviewDiagnostics.requestId ? (
                            <div>
                              <div className="text-[11px] text-muted">requestId</div>
                              <div className="break-all text-slate-100">
                                {selectedPreviewDiagnostics.requestId}
                              </div>
                            </div>
                          ) : null}
                          {typeof selectedPreviewDiagnostics.edgeStatus === "number" ? (
                            <div>
                              <div className="text-[11px] text-muted">edgeStatus (if any)</div>
                              <div className="text-slate-100">
                                {selectedPreviewDiagnostics.edgeStatus}
                              </div>
                            </div>
                          ) : null}
                          <div>
                            <div className="text-[11px] text-muted">content-type</div>
                            <div className="break-all text-slate-100">
                              {selectedPreviewDiagnostics.contentType ?? "—"}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-muted">bytes received</div>
                            <div className="text-slate-100">{selectedPreviewDiagnostics.bytes}</div>
                          </div>
                          <div>
                            <div className="text-[11px] text-muted">attempted</div>
                            <div className="text-slate-100">
                              {new Date(selectedPreviewDiagnostics.attemptedAt).toLocaleTimeString()}
                            </div>
                          </div>
                          <div className="md:col-span-2">
                            <div className="text-[11px] text-muted">error text (if any)</div>
                            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-white/5 bg-black/30 p-2 text-[11px] text-slate-100">
                              {selectedPreviewDiagnostics.errorText ?? "—"}
                            </pre>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 text-[11px] text-muted">
                          No preview test run yet for this file.
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-[11px] text-muted">
                    Select a file to view preview diagnostics.
                  </div>
                )}
              </div>
            </details>
          </div>
        </div>

        <div className="mt-8 space-y-5">
          {prefillContact && (
            <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-100">
              You&apos;re submitting as{" "}
              <span className="font-semibold text-emerald-50">
                {prefillContact.displayName}
              </span>{" "}
              ({prefillContact.email}). Contact details come from your workspace profile.
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label
                htmlFor="firstName"
                className="text-xs font-medium text-muted tracking-wide"
              >
                First name<span className="text-red-500">*</span>
              </label>
              <input
                id="firstName"
                name="firstName"
                type="text"
                autoComplete="given-name"
                value={state.firstName}
                onChange={handleInputChange("firstName")}
                className={clsx(
                  "w-full rounded-md border bg-transparent px-3 py-2 text-sm text-foreground outline-none transition",
                  fieldErrors.firstName ? "border-red-500" : "border-border",
                )}
                aria-invalid={Boolean(fieldErrors.firstName)}
                aria-describedby={
                  fieldErrors.firstName ? "firstName-error" : undefined
                }
              />
              {fieldErrors.firstName && (
                <p id="firstName-error" className="text-xs text-red-400">
                  {fieldErrors.firstName}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <label
                htmlFor="lastName"
                className="text-xs font-medium text-muted tracking-wide"
              >
                Last name<span className="text-red-500">*</span>
              </label>
              <input
                id="lastName"
                name="lastName"
                type="text"
                autoComplete="family-name"
                value={state.lastName}
                onChange={handleInputChange("lastName")}
                className={clsx(
                  "w-full rounded-md border bg-transparent px-3 py-2 text-sm text-foreground outline-none transition",
                  fieldErrors.lastName ? "border-red-500" : "border-border",
                )}
                aria-invalid={Boolean(fieldErrors.lastName)}
                aria-describedby={
                  fieldErrors.lastName ? "lastName-error" : undefined
                }
              />
              {fieldErrors.lastName && (
                <p id="lastName-error" className="text-xs text-red-400">
                  {fieldErrors.lastName}
                </p>
              )}
            </div>
          </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label
              htmlFor="email"
              className="text-xs font-medium text-muted tracking-wide"
            >
              Business email<span className="text-red-500">*</span>
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              {...(contactFieldsLocked
                ? { defaultValue: prefillContact?.email ?? "" }
                : {
                    value: state.email,
                    onChange: handleInputChange("email"),
                  })}
              className={clsx(
                "w-full rounded-md border bg-transparent px-3 py-2 text-sm text-foreground outline-none transition",
                fieldErrors.email ? "border-red-500" : "border-border",
                contactFieldsLocked &&
                  "cursor-not-allowed bg-black/30 text-muted-foreground",
              )}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? "email-error" : undefined}
              readOnly={contactFieldsLocked}
              aria-readonly={contactFieldsLocked}
            />
            {fieldErrors.email && (
              <p id="email-error" className="text-xs text-red-400">
                {fieldErrors.email}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <label
              htmlFor="phone"
              className="text-xs font-medium text-muted tracking-wide"
            >
              Phone (optional)
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              value={state.phone}
              onChange={handleInputChange("phone")}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label
              htmlFor="company"
              className="text-xs font-medium text-muted tracking-wide"
            >
              Company
            </label>
            <input
              id="company"
              name="company"
              type="text"
              autoComplete="organization"
              value={state.company}
              onChange={handleInputChange("company")}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="manufacturingProcess"
              className="text-xs font-medium text-muted tracking-wide"
            >
              Manufacturing process<span className="text-red-500">*</span>
            </label>
            <select
              id="manufacturingProcess"
              name="manufacturingProcess"
              value={state.manufacturingProcess}
              onChange={handleInputChange("manufacturingProcess")}
              className={clsx(
                "w-full rounded-md border bg-black/20 px-3 py-2 text-sm text-foreground outline-none transition",
                fieldErrors.manufacturingProcess
                  ? "border-red-500"
                  : "border-border",
              )}
              aria-invalid={Boolean(fieldErrors.manufacturingProcess)}
              aria-describedby={
                fieldErrors.manufacturingProcess
                  ? "manufacturingProcess-error"
                  : undefined
              }
            >
              <option value="">Select a process</option>
              {MANUFACTURING_PROCESS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {fieldErrors.manufacturingProcess && (
              <p
                id="manufacturingProcess-error"
                className="text-xs text-red-400"
              >
                {fieldErrors.manufacturingProcess}
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label
              htmlFor="exportRestriction"
              className="text-xs font-medium text-muted tracking-wide"
            >
              Export restriction<span className="text-red-500">*</span>
            </label>
            <select
              id="exportRestriction"
              name="exportRestriction"
              value={state.exportRestriction}
              onChange={handleInputChange("exportRestriction")}
              className={clsx(
                "w-full rounded-md border bg-black/20 px-3 py-2 text-sm text-foreground outline-none transition",
                fieldErrors.exportRestriction
                  ? "border-red-500"
                  : "border-border",
              )}
              aria-invalid={Boolean(fieldErrors.exportRestriction)}
              aria-describedby={
                fieldErrors.exportRestriction
                  ? "exportRestriction-error"
                  : undefined
              }
            >
              <option value="">Select an option</option>
              {EXPORT_RESTRICTION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {fieldErrors.exportRestriction && (
              <p id="exportRestriction-error" className="text-xs text-red-400">
                {fieldErrors.exportRestriction}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label
              htmlFor="quantity"
              className="text-xs font-medium text-muted tracking-wide"
            >
              Quantity / volumes<span className="text-red-500">*</span>
            </label>
            <input
              id="quantity"
              name="quantity"
              type="text"
              value={state.quantity}
              onChange={handleInputChange("quantity")}
              placeholder='e.g. "10 proto, 500/yr production"'
              className={clsx(
                "w-full rounded-md border bg-transparent px-3 py-2 text-sm text-foreground outline-none transition",
                fieldErrors.quantity ? "border-red-500" : "border-border",
              )}
              aria-invalid={Boolean(fieldErrors.quantity)}
              aria-describedby={
                fieldErrors.quantity ? "quantity-error" : undefined
              }
            />
            {fieldErrors.quantity && (
              <p id="quantity-error" className="text-xs text-red-400">
                {fieldErrors.quantity}
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label
              htmlFor="shippingPostalCode"
              className="text-xs font-medium text-muted tracking-wide"
            >
              Shipping ZIP / Postal code
            </label>
            <input
              id="shippingPostalCode"
              name="shippingPostalCode"
              type="text"
              autoComplete="postal-code"
              value={state.shippingPostalCode}
              onChange={handleInputChange("shippingPostalCode")}
              className={clsx(
                "w-full rounded-md border bg-transparent px-3 py-2 text-sm text-foreground outline-none transition",
                fieldErrors.shippingPostalCode
                  ? "border-red-500"
                  : "border-border",
              )}
              aria-invalid={Boolean(fieldErrors.shippingPostalCode)}
              aria-describedby={
                fieldErrors.shippingPostalCode
                  ? "shippingPostalCode-error"
                  : undefined
              }
            />
            {fieldErrors.shippingPostalCode && (
              <p id="shippingPostalCode-error" className="text-xs text-red-400">
                {fieldErrors.shippingPostalCode}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label
              htmlFor="rfqReason"
              className="text-xs font-medium text-muted tracking-wide"
            >
              I&apos;m submitting this RFQ because…
            </label>
            <select
              id="rfqReason"
              name="rfqReason"
              value={state.rfqReason}
              onChange={handleInputChange("rfqReason")}
              className="w-full rounded-md border border-border bg-black/20 px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent"
            >
              <option value="">Select a reason (optional)</option>
              {RFQ_REASON_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label
            htmlFor="notes"
            className="text-xs font-medium text-muted tracking-wide"
          >
            Project details / notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={4}
            value={state.notes}
            onChange={handleInputChange("notes")}
            placeholder="Materials, tolerances, target ship date, special requirements..."
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent"
          />
        </div>

        <div className="space-y-3">
          <label className="flex items-start gap-3 text-sm text-foreground">
            <input
              id="itarAcknowledged"
              name="itarAcknowledged"
              type="checkbox"
              value="true"
              checked={state.itarAcknowledged}
              onChange={handleCheckboxChange("itarAcknowledged")}
              className={clsx(
                "mt-1 h-4 w-4 rounded border bg-transparent",
                fieldErrors.itarAcknowledged
                  ? "border-red-500"
                  : "border-line-subtle",
              )}
            />
            <span>
              I acknowledge these parts are not subject to ITAR restrictions.
            </span>
          </label>
          {fieldErrors.itarAcknowledged && (
            <p className="text-xs text-red-400" role="alert">
              {fieldErrors.itarAcknowledged}
            </p>
          )}

          <label className="flex items-start gap-3 text-sm text-foreground">
            <input
              id="termsAccepted"
              name="termsAccepted"
              type="checkbox"
              value="true"
              checked={state.termsAccepted}
              onChange={handleCheckboxChange("termsAccepted")}
              className={clsx(
                "mt-1 h-4 w-4 rounded border bg-transparent",
                fieldErrors.termsAccepted
                  ? "border-red-500"
                  : "border-line-subtle",
              )}
            />
            <span>
              I agree to the{" "}
              <a
                href="/terms"
                className="text-emerald-300 underline-offset-2 hover:underline"
              >
                terms of service
              </a>{" "}
              and{" "}
              <a
                href="/privacy"
                className="text-emerald-300 underline-offset-2 hover:underline"
              >
                privacy policy
              </a>
              .
            </span>
          </label>
          {fieldErrors.termsAccepted && (
            <p className="text-xs text-red-400" role="alert">
              {fieldErrors.termsAccepted}
            </p>
          )}
        </div>

        <div className="pt-2">
          <div className="space-y-3">
            <SubmitButton disabled={!canSubmit} pending={isSubmitting} />
            {!allFilesUploaded ? (
              <p className="text-xs text-muted">
                Uploads must complete (and pass storage proof) before you can submit.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </form>
    {previewOpenForId ? (
      (() => {
        const entry = state.files.find((f) => f.id === previewOpenForId) ?? null;
        const ref = entry ? uploadedRefs[entry.id] ?? null : null;
        const classification = entry
          ? classifyCadFileType({ filename: entry.file.name, extension: null })
          : { ok: false as const };
        if (!entry || !ref || !classification.ok) return null;
        return (
          <CadPreviewModal
            storageSource={{ bucket: ref.bucket, path: ref.path, token: ref.token }}
            filename={entry.file.name}
            cadKind={classification.type}
            title="3D Preview"
            onClose={() => setPreviewOpenForId(null)}
          />
        );
      })()
    ) : null}
    </section>
  );
}

function SubmitButton({ disabled, pending }: { disabled: boolean; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className={clsx(
        primaryCtaClasses,
        "mt-2 w-full px-6 py-3",
        pending && "cursor-wait",
      )}
      aria-busy={pending}
    >
      {pending ? "Submitting…" : "Submit RFQ"}
    </button>
  );
}

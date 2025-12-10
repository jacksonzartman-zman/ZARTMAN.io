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
import { useFormState, useFormStatus } from "react-dom";
import dynamic from "next/dynamic";
import clsx from "clsx";
import {
  CAD_ACCEPT_STRING,
  CAD_FILE_TYPE_DESCRIPTION,
  MAX_UPLOAD_SIZE_BYTES,
  bytesToMegabytes,
  isAllowedCadFileName,
} from "@/lib/cadFileTypes";
import { primaryCtaClasses } from "@/lib/ctas";
import { submitQuoteIntakeAction } from "@/app/quote/actions";
import type { QuoteIntakeActionState } from "@/app/quote/actions";
import { initialQuoteIntakeState } from "@/lib/quote/intakeState";
import { QUOTE_INTAKE_FALLBACK_ERROR } from "@/lib/quote/messages";
import type { CadViewerPanelProps } from "@/app/(portals)/components/CadViewerPanel";
import { PartDfMPanel } from "@/app/(portals)/components/PartDfMPanel";
import type { GeometryStats } from "@/lib/dfm/basicPartChecks";

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
const FIELD_ERROR_KEY_SET = new Set<FieldErrorKey>(FIELD_ERROR_KEYS);

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

const MAX_UPLOAD_SIZE_LABEL = `${bytesToMegabytes(MAX_UPLOAD_SIZE_BYTES)} MB`;
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

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return `File is ${formatReadableBytes(file.size)}. Limit is ${MAX_UPLOAD_SIZE_LABEL}.`;
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
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [geometryStatsMap, setGeometryStatsMap] = useState<
    Record<string, GeometryStats | null>
  >({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [rawFormState, formAction] = useFormState<
    QuoteIntakeActionState,
    FormData
  >(submitQuoteIntakeAction, initialQuoteIntakeState);
  const formState = useMemo<NormalizedActionState | null>(() => {
    if (rawFormState === initialQuoteIntakeState) {
      return null;
    }
    return normalizeActionState(rawFormState);
  }, [rawFormState]);
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

  useEffect(() => {
    if (!hasSubmitted || !formState) {
      return;
    }

    if (formState.ok) {
      setError(null);
      setSuccessMessage(formState.message || "RFQ received.");
      setFieldErrors({});
      resetUploadState();
    } else {
      setError(formState.error);
      setSuccessMessage(null);
      setFieldErrors(formState.fieldErrors);
    }

    setHasSubmitted(false);
  }, [formState, hasSubmitted, resetUploadState]);

  const hasFilesAttached = state.files.length > 0;
  const canSubmit = Boolean(
    hasFilesAttached &&
      state.firstName.trim() &&
      state.lastName.trim() &&
      state.email.trim() &&
      state.manufacturingProcess &&
      state.quantity.trim() &&
      state.exportRestriction &&
      state.itarAcknowledged &&
      state.termsAccepted,
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

  const clearFieldError = (field: FieldErrorKey) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const ingestFiles = useCallback(
    (candidates: File[]) => {
      if (!candidates || candidates.length === 0) {
        return;
      }

      const accepted: File[] = [];
      const rejectionMessages: string[] = [];

      candidates.forEach((file) => {
        const validationError = validateCadFile(file);
        if (validationError) {
          rejectionMessages.push(`${file.name}: ${validationError}`);
          return;
        }
        accepted.push(file);
      });

      if (accepted.length === 0 && rejectionMessages.length > 0) {
        const combined = rejectionMessages.join(" ");
        setError(combined);
        setFieldErrors((prev) => ({ ...prev, file: combined }));
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

      if (rejectionMessages.length > 0) {
        const combined = rejectionMessages.join(" ");
        setError(combined);
        setFieldErrors((prev) => ({ ...prev, file: combined }));
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

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    try {
      setError(null);
      setSuccessMessage(null);

      const validationErrors = validateFormFields(state);
      if (hasErrors(validationErrors)) {
        e.preventDefault();
        setFieldErrors(validationErrors);
        setError("Please fix the highlighted fields before submitting.");
        return;
      }

      if (!hasFilesAttached) {
        e.preventDefault();
        setFieldErrors((prev) => ({
          ...prev,
          file: "Attach at least one CAD file before submitting.",
        }));
        setError("Attach at least one CAD file before submitting.");
        return;
      }

      for (const entry of state.files) {
        const fileValidationError = validateCadFile(entry.file);
        if (fileValidationError) {
          e.preventDefault();
          setFieldErrors((prev) => ({
            ...prev,
            file: `${entry.file.name}: ${fileValidationError}`,
          }));
          setError(`${entry.file.name}: ${fileValidationError}`);
          return;
        }
      }

      setFieldErrors({});
      setHasSubmitted(true);
    } catch (submitError) {
      console.error("[quote intake] submit handler failed", submitError);
      e.preventDefault();
      setError(QUOTE_INTAKE_FALLBACK_ERROR);
      setSuccessMessage(null);
      setHasSubmitted(false);
    }
  };

  return (
    <section
      aria-label="Upload CAD file"
      className="relative flex flex-col rounded-3xl border border-border bg-surface p-6 sm:p-8"
    >
      <form
        onSubmit={handleSubmit}
        action={formAction}
        className="flex flex-col"
        encType="multipart/form-data"
        noValidate
      >
        {successMessage && (
          <div className="mb-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {successMessage}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
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
            {CAD_FILE_TYPE_DESCRIPTION}. Drag in up to {MAX_FILES_PER_RFQ} files. Max {MAX_UPLOAD_SIZE_LABEL} each.
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
                        <span
                          className={clsx(
                            "pill text-[10px] font-semibold uppercase tracking-wide",
                            isSelected ? "pill-info" : "pill-muted",
                          )}
                        >
                          {isSelected ? "Previewing" : "Preview"}
                        </span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleRemovePart(entry.id);
                          }}
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
            <CadViewerPanel
              file={selectedPart?.file ?? null}
              fileName={selectedPart?.file.name}
              fallbackMessage="Select a CAD file to preview it in 3D."
              onGeometryStats={viewerGeometryHandler}
            />
            <PartDfMPanel
              geometryStats={selectedGeometryStats}
              process={state.manufacturingProcess}
              quantityHint={state.quantity}
              targetDate={null}
              className="bg-white/5"
            />
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
          <SubmitButton disabled={!canSubmit} />
        </div>
      </div>
    </form>
    </section>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
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

type NormalizedActionState =
  | {
      ok: true;
      quoteId: string | null;
      uploadId: string;
      message: string;
    }
  | {
      ok: false;
      error: string;
      fieldErrors: FieldErrors;
    };

function normalizeActionState(
  state: QuoteIntakeActionState | null | undefined,
): NormalizedActionState {
  if (!state || typeof state !== "object" || typeof state.ok !== "boolean") {
    return {
      ok: false,
      error: QUOTE_INTAKE_FALLBACK_ERROR,
      fieldErrors: {},
    };
  }

  if (state.ok) {
    return {
      ok: true,
      quoteId: state.quoteId ?? null,
      uploadId: state.uploadId ?? "",
      message: state.message ?? "RFQ received.",
    };
  }

  return {
    ok: false,
    error: state.error || QUOTE_INTAKE_FALLBACK_ERROR,
    fieldErrors: normalizeActionFieldErrors(
      state.fieldErrors as Record<string, unknown> | undefined,
    ),
  };
}

function normalizeActionFieldErrors(
  rawErrors?: Record<string, unknown>,
): FieldErrors {
  if (!rawErrors) {
    return {};
  }

  return Object.entries(rawErrors).reduce<FieldErrors>((acc, [key, value]) => {
    if (
      FIELD_ERROR_KEY_SET.has(key as FieldErrorKey) &&
      typeof value === "string" &&
      value.length > 0
    ) {
      acc[key as FieldErrorKey] = value;
    }
    return acc;
  }, {});
}

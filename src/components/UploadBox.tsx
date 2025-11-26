"use client";

import {
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
import { primaryCtaClasses } from "@/lib/ctas";

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

type FieldErrorKey =
  | "file"
  | "firstName"
  | "lastName"
  | "email"
  | "manufacturingProcess"
  | "quantity"
  | "shippingPostalCode"
  | "exportRestriction"
  | "itarAcknowledged"
  | "termsAccepted";

type FieldErrors = Partial<Record<FieldErrorKey, string>>;

const initialState: UploadState = {
  file: null,
  fileName: null,
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

const MAX_UPLOAD_SIZE_LABEL = `${bytesToMegabytes(MAX_UPLOAD_SIZE_BYTES)} MB`;
const FILE_TYPE_ERROR_MESSAGE = `Unsupported file type. Please upload ${CAD_FILE_TYPE_DESCRIPTION}.`;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

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

const validateFormFields = (state: UploadState): FieldErrors => {
  const errors: FieldErrors = {};
  const trimmedFirstName = state.firstName.trim();
  const trimmedLastName = state.lastName.trim();
  const trimmedEmail = state.email.trim();
  const trimmedQuantity = state.quantity.trim();
  const postal = state.shippingPostalCode;

  if (!state.file) {
    errors.file = "Attach your CAD file before submitting.";
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

export default function UploadBox() {
  const [state, setState] = useState<UploadState>(initialState);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [successDetailMessage, setSuccessDetailMessage] = useState<string | null>(
    null,
  );
  const [isIOSDevice, setIsIOSDevice] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setIsIOSDevice(isIOSUserAgent(navigator.userAgent));
  }, []);

  const canSubmit = Boolean(
    state.file &&
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

  const clearFieldError = (field: FieldErrorKey) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

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
      setFieldErrors((prev) => ({ ...prev, file: validationError }));
      setStatusMessage(null);
      setSuccess(false);
      setSuccessMessage(null);
      setSuccessDetailMessage(null);
      setState((prev) => ({ ...prev, file: null, fileName: null }));
      return;
    }

    clearFieldError("file");
    setError(null);
    setSuccess(false);
    setSuccessMessage(null);
    setSuccessDetailMessage(null);
    setStatusMessage(null);
    setState((prev) => ({ ...prev, file, fileName: file.name }));
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;

    const validationError = validateCadFile(file);
    if (validationError) {
      setError(validationError);
      setFieldErrors((prev) => ({ ...prev, file: validationError }));
      setStatusMessage(null);
      setSuccess(false);
      setSuccessMessage(null);
      setSuccessDetailMessage(null);
      setState((prev) => ({ ...prev, file: null, fileName: null }));
      e.target.value = "";
      return;
    }

    clearFieldError("file");
    setError(null);
    setSuccess(false);
    setSuccessMessage(null);
    setSuccessDetailMessage(null);
    setStatusMessage(null);
    setState((prev) => ({ ...prev, file, fileName: file.name }));
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
      const value = e.target.value;
      setState((prev) => ({ ...prev, [field]: value }));
      if (field in fieldErrors) {
        clearFieldError(field as FieldErrorKey);
      }
    };

  const handleCheckboxChange =
    (field: "itarAcknowledged" | "termsAccepted") =>
    (e: ChangeEvent<HTMLInputElement>) => {
      const checked = e.target.checked;
      setState((prev) => ({ ...prev, [field]: checked }));
      clearFieldError(field);
    };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSuccessMessage(null);
    setSuccessDetailMessage(null);
    setStatusMessage("Validating file…");

    const validationErrors = validateFormFields(state);
    if (hasErrors(validationErrors)) {
      setStatusMessage(null);
      setFieldErrors(validationErrors);
      setError("Please fix the highlighted fields before submitting.");
      return;
    }

    if (!state.file) {
      setStatusMessage(null);
      setFieldErrors((prev) => ({
        ...prev,
        file: "Attach your CAD file before submitting.",
      }));
      setError("Attach your CAD file before submitting.");
      return;
    }

    const fileValidationError = validateCadFile(state.file);
    if (fileValidationError) {
      setStatusMessage(null);
      setFieldErrors((prev) => ({ ...prev, file: fileValidationError }));
      setError(fileValidationError);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    setStatusMessage("Uploading file to Supabase…");

    try {
      const trimmedFirstName = state.firstName.trim();
      const trimmedLastName = state.lastName.trim();
      const fullName = [trimmedFirstName, trimmedLastName]
        .filter(Boolean)
        .join(" ");
      const trimmedEmail = state.email.trim();
      const trimmedCompany = state.company.trim();
      const trimmedPhone = state.phone.trim();
      const trimmedQuantity = state.quantity.trim();
      const trimmedZip = state.shippingPostalCode.trim();
      const trimmedNotes = state.notes.trim();
      const trimmedReason = state.rfqReason.trim();

      const formData = new FormData();
      formData.append("file", state.file);
      formData.append("name", fullName);
      formData.append("email", trimmedEmail);
      formData.append("company", trimmedCompany);
      formData.append("phone", trimmedPhone);
      formData.append("first_name", trimmedFirstName);
      formData.append("last_name", trimmedLastName);
      formData.append("manufacturing_process", state.manufacturingProcess);
      formData.append("quantity", trimmedQuantity);
      formData.append("shipping_postal_code", trimmedZip);
      formData.append("export_restriction", state.exportRestriction);
      formData.append("rfq_reason", trimmedReason);
      formData.append("notes", trimmedNotes);
      formData.append(
        "itar_acknowledged",
        state.itarAcknowledged ? "true" : "false",
      );
      formData.append(
        "terms_accepted",
        state.termsAccepted ? "true" : "false",
      );

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

      const storageDetail =
        structuredPayload.file?.storagePath &&
        structuredPayload.metadataRecorded
          ? `Stored as ${structuredPayload.file.storagePath}.`
          : null;

      const metadataWarning =
        structuredPayload.metadataRecorded === false
          ? "Some advanced file details may be unavailable. This won’t affect your quote."
          : null;

      const responseMessage =
        payloadMessage ?? "Upload complete. We'll review your CAD shortly.";
      const detailMessage = metadataWarning ?? storageDetail ?? null;

      setStatusMessage(null);
      setState(initialState);
      setFieldErrors({});
      setSuccess(true);
      setSuccessMessage(responseMessage);
      setSuccessDetailMessage(detailMessage);
      setError(null);
    } catch (err: unknown) {
      console.error(err);
      setStatusMessage(null);
      setError(
        err instanceof Error
          ? err.message
          : "Upload failed. Please try again.",
      );
      setSuccess(false);
      setSuccessMessage(null);
      setSuccessDetailMessage(null);
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
          accept={fileInputAccept}
        />
        {fieldErrors.file && (
          <p className="mt-3 text-xs text-red-400" role="alert">
            {fieldErrors.file}
          </p>
        )}
      </div>

      {/* Form fields */}
      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
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
              type="email"
              autoComplete="email"
              value={state.email}
              onChange={handleInputChange("email")}
              className={clsx(
                "w-full rounded-md border bg-transparent px-3 py-2 text-sm text-foreground outline-none transition",
                fieldErrors.email ? "border-red-500" : "border-border",
              )}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? "email-error" : undefined}
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
              type="checkbox"
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
              type="checkbox"
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

        {/* Upload CTA */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting || !canSubmit}
              className={clsx(
                primaryCtaClasses,
                "mt-2 w-full px-6 py-3",
                isSubmitting && "cursor-wait",
              )}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? "Submitting…" : "Submit RFQ"}
            </button>
          </div>

        {/* Messages */}
        <div className="min-h-[1.25rem] pt-1">
          {error && (
            <p className="text-xs text-red-400" role="alert">
              {error}
            </p>
          )}
          {!error && statusMessage && (
            <p className="text-xs text-slate-400" role="status">
              {statusMessage}
            </p>
          )}
          {!error && !statusMessage && success && successMessage && (
            <div className="space-y-1" role="status">
              <p className="text-xs text-emerald-400">{successMessage}</p>
              {successDetailMessage && (
                <p className="text-[11px] text-emerald-200">
                  {successDetailMessage}
                </p>
              )}
            </div>
          )}
        </div>
      </form>
    </section>
  );
}

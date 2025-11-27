"use client";

import {
  useState,
  DragEvent,
  ChangeEvent,
  FormEvent,
  useEffect,
  useRef,
} from "react";
import { useFormState, useFormStatus } from "react-dom";
import clsx from "clsx";
import {
  CAD_ACCEPT_STRING,
  CAD_FILE_TYPE_DESCRIPTION,
  MAX_UPLOAD_SIZE_BYTES,
  bytesToMegabytes,
  isAllowedCadFileName,
} from "@/lib/cadFileTypes";
import { primaryCtaClasses } from "@/lib/ctas";
import {
  initialQuoteIntakeState,
  submitQuoteIntakeAction,
  type QuoteIntakeActionState,
} from "@/app/quote/actions";

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
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isIOSDevice, setIsIOSDevice] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [formState, formAction] = useFormState<
    QuoteIntakeActionState,
    FormData
  >(submitQuoteIntakeAction, initialQuoteIntakeState);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setIsIOSDevice(isIOSUserAgent(navigator.userAgent));
  }, []);

  useEffect(() => {
    if (!hasSubmitted) {
      return;
    }

    if (formState.ok) {
      setError(null);
      setSuccessMessage(formState.message ?? "RFQ received.");
      setFieldErrors({});
      setState(initialState);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setHasSubmitted(false);
    } else if (formState.error) {
      setError(formState.error);
      setSuccessMessage(null);
      setFieldErrors(formState.fieldErrors ?? {});
      setHasSubmitted(false);
    }
  }, [formState, hasSubmitted]);

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
      setSuccessMessage(null);
      setState((prev) => ({ ...prev, file: null, fileName: null }));
      return;
    }

    clearFieldError("file");
    setError(null);
    setSuccessMessage(null);
    setState((prev) => ({ ...prev, file, fileName: file.name }));
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;

    const validationError = validateCadFile(file);
    if (validationError) {
      setError(validationError);
      setFieldErrors((prev) => ({ ...prev, file: validationError }));
      setSuccessMessage(null);
      setState((prev) => ({ ...prev, file: null, fileName: null }));
      e.target.value = "";
      return;
    }

    clearFieldError("file");
    setError(null);
    setSuccessMessage(null);
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
    setError(null);
    setSuccessMessage(null);

    const validationErrors = validateFormFields(state);
    if (hasErrors(validationErrors)) {
      e.preventDefault();
      setFieldErrors(validationErrors);
      setError("Please fix the highlighted fields before submitting.");
      return;
    }

    if (!state.file) {
      e.preventDefault();
      setFieldErrors((prev) => ({
        ...prev,
        file: "Attach your CAD file before submitting.",
      }));
      setError("Attach your CAD file before submitting.");
      return;
    }

    const fileValidationError = validateCadFile(state.file);
    if (fileValidationError) {
      e.preventDefault();
      setFieldErrors((prev) => ({ ...prev, file: fileValidationError }));
      setError(fileValidationError);
      return;
    }

    setFieldErrors({});
    setHasSubmitted(true);
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
            ref={fileInputRef}
          />
          {fieldErrors.file && (
            <p className="mt-3 text-xs text-red-400" role="alert">
              {fieldErrors.file}
            </p>
          )}
        </div>

        <div className="mt-8 space-y-5">
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

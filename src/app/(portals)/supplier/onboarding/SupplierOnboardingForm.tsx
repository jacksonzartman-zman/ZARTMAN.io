"use client";

import type { ReactNode } from "react";
import { useId, useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";
import {
  submitSupplierOnboardingAction,
  type SupplierOnboardingState,
} from "./actions";

type CapabilityDraft = {
  id: string;
  process: string;
  materialsInput: string;
  certificationsInput: string;
  maxPartSize: {
    x?: string;
    y?: string;
    z?: string;
    units?: string;
  };
};

type DocumentDraft = {
  id: string;
  docType: string;
};

const INITIAL_STATE: SupplierOnboardingState = {
  success: false,
  error: null,
  fieldErrors: {},
};

const PROCESS_OPTIONS = ["CNC", "Sheet metal", "MJF", "FDM", "SLA", "Injection molding"];

export function SupplierOnboardingForm({
  defaultEmail,
  defaultCompany,
  defaultPhone,
  defaultWebsite,
  defaultCountry,
  supplierId,
}: {
  defaultEmail?: string | null;
  defaultCompany?: string | null;
  defaultPhone?: string | null;
  defaultWebsite?: string | null;
  defaultCountry?: string | null;
  supplierId?: string | null;
}) {
  const [capabilities, setCapabilities] = useState<CapabilityDraft[]>([
    createCapabilityDraft(),
  ]);
  const [documents, setDocuments] = useState<DocumentDraft[]>([
    createDocumentDraft(),
  ]);
  const [state, formAction] = useFormState<
    SupplierOnboardingState,
    FormData
  >(submitSupplierOnboardingAction, INITIAL_STATE);

  const capabilitiesPayload = useMemo(
    () =>
      JSON.stringify(
        capabilities.map((capability) => ({
          process: capability.process,
          materials: splitCommaSeparated(capability.materialsInput),
          certifications: splitCommaSeparated(capability.certificationsInput),
          maxPartSize: {
            x: parseNumber(capability.maxPartSize.x),
            y: parseNumber(capability.maxPartSize.y),
            z: parseNumber(capability.maxPartSize.z),
            units: capability.maxPartSize.units?.trim() || undefined,
          },
        })),
      ),
    [capabilities],
  );

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="capabilities_payload" value={capabilitiesPayload} />
      <input type="hidden" name="document_count" value={documents.length} />
        <input type="hidden" name="supplier_id" value={supplierId ?? ""} />

      <Section title="Company profile" description="Basic info so customers know who they’re working with.">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="Company name"
            name="company_name"
            required
            placeholder="Lambda Precision"
            error={state.fieldErrors?.company_name}
              defaultValue={defaultCompany ?? undefined}
          />
          <TextField
            label="Primary email"
            name="primary_email"
            type="email"
            placeholder="ops@lambda-precision.com"
            defaultValue={defaultEmail ?? undefined}
            required
            error={state.fieldErrors?.primary_email}
          />
          <TextField
            label="Phone"
            name="phone"
            placeholder="+1 (555) 123-9876"
              defaultValue={defaultPhone ?? undefined}
          />
          <TextField
            label="Website"
            name="website"
            placeholder="https://lambda-precision.com"
              defaultValue={defaultWebsite ?? undefined}
          />
          <TextField
            label="Country"
            name="country"
            placeholder="United States"
              defaultValue={defaultCountry ?? undefined}
          />
        </div>
      </Section>

      <Section
        title="Manufacturing capabilities"
        description="List each process you support along with go-to materials and certifications."
      >
        <div className="space-y-4">
          {capabilities.map((capability, index) => (
            <div
              key={capability.id}
              className="rounded-2xl border border-slate-800/80 bg-slate-950/40 p-4"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">
                  Capability {index + 1}
                </p>
                {capabilities.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeCapability(capability.id, setCapabilities)}
                    className="text-xs text-slate-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Process
                  </label>
                  <input
                    list={`process-options-${capability.id}`}
                    value={capability.process}
                    onChange={(event) =>
                      updateCapability(capability.id, setCapabilities, {
                        process: event.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:border-blue-400 focus:outline-none"
                    placeholder="CNC"
                    required={index === 0}
                  />
                  <datalist id={`process-options-${capability.id}`}>
                    {PROCESS_OPTIONS.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Certifications
                  </label>
                  <input
                    value={capability.certificationsInput}
                    onChange={(event) =>
                      updateCapability(capability.id, setCapabilities, {
                        certificationsInput: event.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:border-blue-400 focus:outline-none"
                    placeholder="ISO 9001, AS9100"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Preferred materials
                  </label>
                  <input
                    value={capability.materialsInput}
                    onChange={(event) =>
                      updateCapability(capability.id, setCapabilities, {
                        materialsInput: event.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:border-blue-400 focus:outline-none"
                    placeholder="6061 Aluminum, ABS, PA12"
                  />
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {(["x", "y", "z"] as const).map((axis) => (
                    <div key={axis}>
                      <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        {axis.toUpperCase()} (in)
                      </label>
                      <input
                        value={capability.maxPartSize[axis] ?? ""}
                        onChange={(event) =>
                          updateCapability(capability.id, setCapabilities, {
                            maxPartSize: {
                              ...capability.maxPartSize,
                              [axis]: event.target.value,
                            },
                          })
                        }
                        inputMode="decimal"
                        className="mt-1 w-full rounded-lg border border-slate-800 bg-black/40 px-2 py-1 text-sm text-slate-100 focus:border-blue-400 focus:outline-none"
                        placeholder="0"
                      />
                    </div>
                  ))}
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Units
                    </label>
                    <input
                      value={capability.maxPartSize.units ?? ""}
                      onChange={(event) =>
                        updateCapability(capability.id, setCapabilities, {
                          maxPartSize: {
                            ...capability.maxPartSize,
                            units: event.target.value,
                          },
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-800 bg-black/40 px-2 py-1 text-sm text-slate-100 focus:border-blue-400 focus:outline-none"
                      placeholder="in / mm"
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setCapabilities((prev) => [...prev, createCapabilityDraft()])}
          className="mt-3 rounded-full border border-slate-700 px-4 py-1.5 text-xs font-semibold text-blue-300 transition hover:border-blue-400 hover:text-blue-200"
        >
          + Add capability
        </button>
      </Section>

      <Section
        title="Compliance documents"
        description="Upload certs or insurance docs. Customers see the doc type and a download link."
      >
        {state.fieldErrors?.documents ? (
          <p className="text-sm text-red-300">{state.fieldErrors.documents}</p>
        ) : null}
        <div className="space-y-4">
          {documents.map((document, index) => (
            <div
              key={document.id}
              className="rounded-2xl border border-slate-800/80 bg-slate-950/40 p-4"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">
                  Document {index + 1}
                </p>
                {documents.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeDocument(document.id, setDocuments)}
                    className="text-xs text-slate-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)]">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Doc type
                  </label>
                  <input
                    name={`document_${index}_type`}
                    value={document.docType}
                    onChange={(event) =>
                      updateDocument(document.id, setDocuments, event.target.value)
                    }
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:border-blue-400 focus:outline-none"
                    placeholder="ISO 9001 cert"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    File
                  </label>
                  <input
                    type="file"
                    name={`document_${index}_file`}
                    accept=".pdf,.png,.jpg,.jpeg,.webp"
                    className="mt-1 block w-full text-sm text-slate-200 file:mr-4 file:rounded-full file:border-0 file:bg-blue-500/20 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-blue-100 hover:file:bg-blue-500/30"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        {documents.length < 5 && (
          <button
            type="button"
            onClick={() => setDocuments((prev) => [...prev, createDocumentDraft()])}
            className="mt-3 rounded-full border border-slate-700 px-4 py-1.5 text-xs font-semibold text-blue-300 transition hover:border-blue-400 hover:text-blue-200"
          >
            + Add document
          </button>
        )}
      </Section>

      {state.error ? (
        <p className="text-sm text-red-300" role="alert">
          {state.error}
        </p>
      ) : null}

      <SubmitButton label="Submit onboarding" />
    </form>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-950/60 p-5 shadow-sm shadow-slate-950/20">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {description ? (
        <p className="mt-1 text-sm text-slate-400">{description}</p>
      ) : null}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function TextField({
  label,
  name,
  type = "text",
  placeholder,
  defaultValue,
  required,
  error,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  error?: string;
}) {
  const inputId = useId();
  return (
    <div>
      <label
        htmlFor={inputId}
        className="text-xs font-semibold uppercase tracking-wide text-slate-400"
      >
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className="mt-1 w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-400 focus:outline-none"
      />
      {error ? <p className="mt-1 text-xs text-red-300">{error}</p> : null}
    </div>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${primaryCtaClasses} ${ctaSizeClasses.md}`}
    >
      {pending ? "Saving..." : label}
    </button>
  );
}

function createCapabilityDraft(): CapabilityDraft {
  return {
    id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
    process: "",
    materialsInput: "",
    certificationsInput: "",
    maxPartSize: {},
  };
}

function createDocumentDraft(): DocumentDraft {
  return {
    id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
    docType: "",
  };
}

function updateCapability(
  capabilityId: string,
  setCapabilities: React.Dispatch<React.SetStateAction<CapabilityDraft[]>>,
  nextValues: Partial<CapabilityDraft>,
) {
  setCapabilities((prev) =>
    prev.map((capability) =>
      capability.id === capabilityId
        ? {
            ...capability,
            ...nextValues,
            maxPartSize: {
              ...capability.maxPartSize,
              ...nextValues.maxPartSize,
            },
          }
        : capability,
    ),
  );
}

function removeCapability(
  capabilityId: string,
  setCapabilities: React.Dispatch<React.SetStateAction<CapabilityDraft[]>>,
) {
  setCapabilities((prev) =>
    prev.length === 1 ? prev : prev.filter((capability) => capability.id !== capabilityId),
  );
}

function updateDocument(
  documentId: string,
  setDocuments: React.Dispatch<React.SetStateAction<DocumentDraft[]>>,
  docType: string,
) {
  setDocuments((prev) =>
    prev.map((document) =>
      document.id === documentId ? { ...document, docType } : document,
    ),
  );
}

function removeDocument(
  documentId: string,
  setDocuments: React.Dispatch<React.SetStateAction<DocumentDraft[]>>,
) {
  setDocuments((prev) =>
    prev.length === 1 ? prev : prev.filter((document) => document.id !== documentId),
  );
}

function splitCommaSeparated(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseNumber(value?: string) {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

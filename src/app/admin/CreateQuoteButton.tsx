"use client";

import clsx from "clsx";
import { useFormState, useFormStatus } from "react-dom";
import {
  createQuoteFromUploadAction,
  type CreateQuoteActionState,
} from "./actions";
import { primaryCtaClasses } from "@/lib/ctas";

type Alignment = "start" | "center" | "end";

type CreateQuoteButtonProps = {
  uploadId: string;
  label?: string;
  size?: "sm" | "md";
  align?: Alignment;
  className?: string;
};

const INITIAL_STATE: CreateQuoteActionState = {};

export default function CreateQuoteButton({
  uploadId,
  label = "Create quote",
  size = "md",
  align = "start",
  className,
}: CreateQuoteButtonProps) {
  const [state, formAction] = useFormState(
    createQuoteFromUploadAction,
    INITIAL_STATE,
  );

  return (
    <form
      action={formAction}
      className={clsx(
        "flex flex-col gap-1",
        align === "end"
          ? "items-end text-right"
          : align === "center"
            ? "items-center text-center"
            : "items-start text-left",
        className,
      )}
    >
      <input type="hidden" name="upload_id" value={uploadId} />
      <CreateQuoteSubmit label={label} size={size} />
      {state?.error && (
        <p
          className={clsx(
            "text-xs text-red-400",
            align === "end"
              ? "text-right"
              : align === "center"
                ? "text-center"
                : "text-left",
          )}
        >
          {state.error}
        </p>
      )}
    </form>
  );
}

type CreateQuoteSubmitProps = {
  label: string;
  size: "sm" | "md";
};

function CreateQuoteSubmit({ label, size }: CreateQuoteSubmitProps) {
  const { pending } = useFormStatus();
  const sizeClasses = size === "sm" ? "px-4 py-1.5 text-xs" : "";

  return (
    <button
      type="submit"
      disabled={pending}
      className={clsx(primaryCtaClasses, sizeClasses)}
    >
      {pending ? "Creating..." : label}
    </button>
  );
}

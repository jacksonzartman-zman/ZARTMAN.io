// src/app/admin/AdminSearchInput.tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type FormEvent,
  type HTMLInputTypeAttribute,
  useEffect,
  useState,
  useTransition,
} from "react";
import { primaryCtaClasses } from "@/lib/ctas";
import {
  parseListState,
  setSearch,
  type ListStateConfig,
} from "@/app/(portals)/lib/listState";

type AdminSearchInputProps = {
  initialValue?: string;
  placeholder?: string;
  basePath?: string;
  inputType?: HTMLInputTypeAttribute;
  listStateConfig?: ListStateConfig;
};

export default function AdminSearchInput({
  initialValue = "",
  placeholder = "Search company, contact, email, or file...",
  basePath,
  inputType = "search",
  listStateConfig,
}: AdminSearchInputProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialValue);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const targetPath = basePath || pathname;

  const navigateWithValue = (nextValue: string) => {
    if (listStateConfig) {
      const state = parseListState(searchParams, listStateConfig);
      const query = setSearch(state, nextValue, listStateConfig);
      const nextUrl = query ? `${targetPath}?${query}` : targetPath;

      startTransition(() => {
        router.push(nextUrl, { scroll: false });
      });
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    const trimmed = nextValue.trim();

    if (trimmed.length > 0) params.set("search", trimmed);
    else params.delete("search");

    const query = params.toString();
    const nextUrl = query ? `${targetPath}?${query}` : targetPath;

    startTransition(() => {
      router.push(nextUrl, { scroll: false });
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigateWithValue(value);
  };

  const handleClear = () => {
    setValue("");
    navigateWithValue("");
  };

  const searchId = "admin-inbox-search";

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full items-center gap-2"
      aria-label="Search RFQs"
    >
      <div className="relative flex-1">
        <label htmlFor={searchId} className="sr-only">
          Search RFQs
        </label>
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="16.65" y1="16.65" x2="21" y2="21" />
          </svg>
        </span>
        <input
          id={searchId}
          type={inputType}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-slate-700 bg-slate-950/60 pl-9 pr-10 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-emerald-400 focus:bg-slate-950"
          disabled={isPending}
        />
        {value.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute inset-y-0 right-10 flex items-center text-slate-500 transition hover:text-emerald-300"
            aria-label="Clear search"
            disabled={isPending}
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        )}
      </div>
      <button
        type="submit"
        className={`${primaryCtaClasses} whitespace-nowrap`}
        disabled={isPending}
      >
        Search
      </button>
    </form>
  );
}

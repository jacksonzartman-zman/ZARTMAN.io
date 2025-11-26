'use client';

import Link from "next/link";
import clsx from "clsx";

/**
 * BrandMark renders the geometric Zartman.io logo + optional wordmark.
 * Use it anywhere a branded home link is needed (marketing/site header,
 * portal shells, simple nav bars). Size controls the icon, while
 * withWordmark/subLabel toggle the adjacent label stack.
 */
export type BrandMarkProps = {
  size?: number;
  withWordmark?: boolean;
  subLabel?: string;
  className?: string;
};

export function BrandMark({
  size = 24,
  withWordmark = false,
  subLabel,
  className,
}: BrandMarkProps) {
  return (
    <Link
      href="/"
      aria-label="Zartman.io home"
      className={clsx(
        "inline-flex items-center gap-2 text-inherit transition-colors hover:opacity-80",
        className,
      )}
    >
      <span className="flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M11.8 3.75h8.4c1.37 0 2.63.73 3.32 1.92l6.65 11.48c.68 1.18.68 2.64 0 3.82l-6.65 11.48a3.76 3.76 0 0 1-3.32 1.92h-8.4a3.76 3.76 0 0 1-3.32-1.92L1.83 20.97a3.76 3.76 0 0 1 0-3.82l6.65-11.48A3.76 3.76 0 0 1 11.8 3.75Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M9.5 10.8c0-.88.72-1.6 1.6-1.6h11.3c.88 0 1.6.72 1.6 1.6v1.45c0 .88-.72 1.6-1.6 1.6h-6.33l6.71 7.75c.62.71.55 1.78-.16 2.4a1.69 1.69 0 0 1-1.11.41H9.88c-.88 0-1.6-.72-1.6-1.6v-1.45c0-.88.72-1.6 1.6-1.6h6.5L9.66 12.2a1.6 1.6 0 0 1-.16-.74V10.8Z"
            fill="currentColor"
          />
        </svg>
      </span>

      {withWordmark ? (
        <span className="flex min-w-0 flex-col leading-tight text-left text-current">
          <span className="text-base font-medium">Zartman.io</span>
          {subLabel ? (
            <span className="text-[11px] font-medium uppercase tracking-[0.3em] text-slate-400">
              {subLabel}
            </span>
          ) : null}
        </span>
      ) : null}
    </Link>
  );
}

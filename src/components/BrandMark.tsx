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
      <span
        className="flex shrink-0 items-center justify-center"
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 32 32"
          aria-hidden="true"
          className="drop-shadow-[0_3px_10px_rgba(15,23,42,0.5)]"
        >
          <path d="M4 6H28V12L16 22H28V26H4V20L16 10H4V6Z" fill="white" />
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

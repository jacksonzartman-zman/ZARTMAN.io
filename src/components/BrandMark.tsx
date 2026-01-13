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
  href?: string;
  size?: number;
  withWordmark?: boolean;
  subLabel?: string;
  className?: string;
};

export function BrandMark({
  href = "/",
  size = 32,
  withWordmark = false,
  subLabel,
  className,
}: BrandMarkProps) {
  return (
    <Link
      href={href}
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
  viewBox="0 0 300 300"
  aria-hidden="true"
  className="drop-shadow-[0_3px_10px_rgba(15,23,42,0.5)]"
>
  <g transform="translate(0,300) scale(0.1,-0.1)" fill="white" stroke="none">
    <path d="M713 2320 c-38 -15 -43 -42 -43 -208 0 -146 2 -161 21 -186 l20 -26 484 0 c266 0 486 -4 489 -8 6 -10 -51 -68 -577 -599 -266 -269 -423 -435 -432 -457 -24 -57 -19 -103 14 -137 l29 -29 782 0 781 0 24 25 c25 24 25 27 25 198 0 161 -1 175 -20 195 -21 22 -23 22 -403 22 -210 0 -388 4 -395 9 -10 6 56 79 245 272 142 145 329 337 416 426 l157 161 0 155 c0 144 -1 155 -21 173 -20 18 -50 19 -798 21 -435 1 -786 -2 -798 -7z m1580 -180 l-1 -150 -450 -458 -451 -457 450 -3 449 -2 0 -180 0 -180 -795 0 -795 0 0 58 1 57 548 555 549 555 -544 3 -544 2 0 175 0 175 793 0 792 0 -2 -150z" />
    <path d="M953 1567 c-235 -237 -282 -289 -288 -319 -4 -20 -5 -88 -3 -152 3 -102 6 -118 24 -137 20 -20 23 -20 50 -5 28 15 195 181 612 608 214 219 227 239 180 272 -18 13 -52 16 -158 16 l-135 0 -282 -283z m565 233 c-1 -5 -185 -195 -408 -422 l-405 -413 -3 143 -3 143 273 279 273 279 138 1 c85 0 137 -4 135 -10z" />
  </g>
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

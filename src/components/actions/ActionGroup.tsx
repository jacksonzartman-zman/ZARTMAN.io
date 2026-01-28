import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";

const ACTION_PILL_BASE =
  "w-full inline-flex items-start justify-start rounded-xl border px-3 py-2 text-[11px] font-semibold leading-snug transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

const ACTION_PILL_DEFAULT =
  "border-slate-800 bg-slate-950/50 text-slate-200 hover:border-slate-600 hover:text-white focus-visible:outline-emerald-400";

const ACTION_PILL_WARNING =
  "border-amber-500/40 bg-amber-500/10 text-amber-100 hover:border-amber-400 hover:bg-amber-500/15 focus-visible:outline-amber-400";

export type ActionGroupProps = {
  children: ReactNode;
  className?: string;
};

export function ActionGroup({ children, className }: ActionGroupProps) {
  return <div className={clsx("w-full", className)}>{children}</div>;
}

export type ActionGroupSectionProps = {
  title?: string;
  children: ReactNode;
  divider?: boolean;
  className?: string;
};

export function ActionGroupSection({
  title,
  children,
  divider,
  className,
}: ActionGroupSectionProps) {
  return (
    <section
      className={clsx(
        "w-full",
        divider && "mt-3 border-t border-slate-800/60 pt-3",
        !divider && "mt-3 first:mt-0",
        className,
      )}
    >
      {title ? (
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
          {title}
        </p>
      ) : null}
      <div className="flex w-full flex-col gap-2">{children}</div>
    </section>
  );
}

type ActionPillCommonProps = {
  children: ReactNode;
  className?: string;
  title?: string;
  variant?: "default" | "warning";
};

function getVariantClasses(variant: ActionPillCommonProps["variant"]) {
  return variant === "warning" ? ACTION_PILL_WARNING : ACTION_PILL_DEFAULT;
}

export type ActionPillLinkProps = ActionPillCommonProps & {
  href: string;
  target?: string;
  rel?: string;
};

export function ActionPillLink({
  href,
  target,
  rel,
  title,
  children,
  className,
  variant = "default",
}: ActionPillLinkProps) {
  return (
    <Link
      href={href}
      target={target}
      rel={rel}
      className={clsx(
        ACTION_PILL_BASE,
        getVariantClasses(variant),
        "whitespace-normal break-words text-left",
        className,
      )}
      title={title}
    >
      {children}
    </Link>
  );
}

export type ActionPillButtonProps = ActionPillCommonProps & {
  type?: "button" | "submit" | "reset";
};

export function ActionPillButton({
  type = "button",
  title,
  children,
  className,
  variant = "default",
}: ActionPillButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        ACTION_PILL_BASE,
        getVariantClasses(variant),
        "whitespace-normal break-words text-left",
        className,
      )}
      title={title}
    >
      {children}
    </button>
  );
}

export type ActionMenuItem = {
  key: string;
  label: string;
  href: string;
  title?: string;
  target?: string;
  rel?: string;
};

export type ActionPillMenuProps = {
  label: string;
  items: ActionMenuItem[];
  title?: string;
  className?: string;
};

export function ActionPillMenu({ label, items, title, className }: ActionPillMenuProps) {
  if (items.length === 0) return null;

  return (
    <details className={clsx("group relative w-full", className)}>
      <summary
        className={clsx(
          ACTION_PILL_BASE,
          ACTION_PILL_DEFAULT,
          "cursor-pointer list-none select-none whitespace-normal break-words text-left",
        )}
        title={title}
      >
        <span className="flex w-full items-center justify-between gap-2">
          <span>{label}</span>
          <span className="text-slate-400 transition group-open:text-slate-200" aria-hidden>
            ▾
          </span>
        </span>
      </summary>
      <div className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-xl">
        <div className="max-h-64 overflow-auto py-1">
          {items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              target={item.target}
              rel={item.rel}
              title={item.title}
              className="block px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-900/60 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </details>
  );
}


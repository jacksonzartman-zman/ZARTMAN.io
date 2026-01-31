import clsx from "clsx";
import type { ReactNode } from "react";
import { PORTAL_SURFACE_CARD_INTERACTIVE } from "./components/PortalShell";

type PortalCardProps = {
  id?: string;
  title: string;
  description?: string;
  header?: boolean;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export default function PortalCard({
  id,
  title,
  description,
  header = true,
  children,
  action,
  className,
}: PortalCardProps) {
  const showHeader = header !== false;

  return (
    <section
      id={id}
      className={clsx(
        PORTAL_SURFACE_CARD_INTERACTIVE,
        "p-6",
        className,
      )}
    >
      {showHeader ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-50 heading-tight sm:text-lg">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-sm text-slate-400 heading-snug">{description}</p>
            ) : null}
          </div>
          {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
        </div>
      ) : null}
      {children ? (
        <div className={clsx(showHeader ? "mt-5" : undefined, "text-sm text-slate-200")}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

import type { ReactNode } from "react";
import clsx from "clsx";

type AdminFiltersBarProps = {
  filters: ReactNode;
  search: ReactNode;
  className?: string;
};

export default function AdminFiltersBar({
  filters,
  search,
  className,
}: AdminFiltersBarProps) {
  return (
    <section
      className={clsx(
        "flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between",
        className,
      )}
    >
      <div className="w-full overflow-x-auto">{filters}</div>
      <div className="w-full lg:w-96">{search}</div>
    </section>
  );
}

import clsx from "clsx";
import type { ReactNode } from "react";

type PortalContainerProps = {
  children: ReactNode;
  className?: string;
};

export function PortalContainer({ children, className }: PortalContainerProps) {
  return (
    <div
      className={clsx(
        // 12-col portal rails target ~320–360px on lg+ (3/12 of 84rem ≈ 336px)
        "mx-auto w-full max-w-[84rem] px-4 sm:px-6 lg:px-8",
        className,
      )}
    >
      {children}
    </div>
  );
}


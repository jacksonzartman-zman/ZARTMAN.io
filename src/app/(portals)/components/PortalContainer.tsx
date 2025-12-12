import clsx from "clsx";
import type { ReactNode } from "react";

type PortalContainerProps = {
  children: ReactNode;
  className?: string;
};

export function PortalContainer({ children, className }: PortalContainerProps) {
  return (
    <div
      className={clsx("mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8", className)}
    >
      {children}
    </div>
  );
}


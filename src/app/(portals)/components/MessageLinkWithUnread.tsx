"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";

export function MessageLinkWithUnread({
  href,
  unread,
  className,
  children,
}: {
  href: string;
  unread: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [visibleUnread, setVisibleUnread] = useState<boolean>(unread);

  return (
    <Link
      href={href}
      onClick={() => setVisibleUnread(false)}
      className={clsx("inline-flex items-center justify-center gap-2", className)}
    >
      <span>{children}</span>
      {visibleUnread ? (
        <span
          className="inline-block h-2 w-2 rounded-full bg-red-500"
          aria-label="Unread messages"
          title="Unread messages"
        />
      ) : null}
    </Link>
  );
}


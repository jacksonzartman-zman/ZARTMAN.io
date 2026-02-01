"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { UnreadBadge } from "@/components/shared/primitives/UnreadBadge";

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
      <UnreadBadge show={visibleUnread} />
    </Link>
  );
}


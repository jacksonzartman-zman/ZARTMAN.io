"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePathname } from "next/navigation";

type SuccessBannerProps = {
  message: string;
};

export function SuccessBanner({ message }: SuccessBannerProps) {
  const [visible, setVisible] = useState(true);
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  useEffect(() => {
  if (!visible) return;

  const timer = setTimeout(() => {
    // Build a clean copy of the current query params
    const params = new URLSearchParams(searchParams.toString());
    params.delete("updated");

    const queryString = params.toString();
    const newUrl = queryString
      ? `${pathname}?${queryString}`
      : pathname;

    // Update URL without a full navigation
    router.replace(newUrl, { scroll: false });

    // Hide the banner
    setVisible(false);
  }, 4000);

  return () => clearTimeout(timer);
}, [visible, searchParams, pathname, router]);

  if (!visible) return null;

  return (
    <div className="mb-6 rounded-md border border-emerald-500 bg-emerald-900/70 px-4 py-3 text-sm text-emerald-50">
      {message}
    </div>
  );
}
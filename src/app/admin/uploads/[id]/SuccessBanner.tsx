"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type SuccessBannerProps = {
  message: string;
};

export function SuccessBanner({ message }: SuccessBannerProps) {
  const [visible, setVisible] = useState(true);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!visible) return;

    const timer = setTimeout(() => {
      setVisible(false);

      // Remove ?updated=1 from the URL so it doesn't re-show on refresh
      const params = new URLSearchParams(searchParams.toString());
      params.delete("updated");

      const queryString = params.toString();
      const newUrl = queryString ? `?${queryString}` : "."; // keep same path

      router.replace(newUrl, { scroll: false });
    }, 4000); // 4 seconds

    return () => clearTimeout(timer);
  }, [visible, router, searchParams]);

  if (!visible) return null;

  return (
    <div className="mb-6 rounded-md border border-emerald-500 bg-emerald-900/70 px-4 py-3 text-sm text-emerald-50">
      {message}
    </div>
  );
}
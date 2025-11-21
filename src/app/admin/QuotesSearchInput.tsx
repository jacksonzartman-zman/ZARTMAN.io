"use client";

import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useState,
} from "react";

type QuotesSearchInputProps = {
  initialValue?: string;
  placeholder?: string;
  className?: string;
};

export default function QuotesSearchInput({
  initialValue = "",
  placeholder,
  className,
}: QuotesSearchInputProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const updateSearchParam = useCallback(
    (nextValue: string) => {
      const params = new URLSearchParams(searchParams.toString());
      const trimmed = nextValue.trim();

      if (trimmed.length > 0) {
        params.set("search", nextValue);
      } else {
        params.delete("search");
      }

      const query = params.toString();
      const target = query ? `${pathname}?${query}` : pathname;

      router.replace(target, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setValue(nextValue);
    updateSearchParam(nextValue);
  };

  return (
    <input
      type="search"
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      className={className}
      aria-label="Search quotes"
    />
  );
}

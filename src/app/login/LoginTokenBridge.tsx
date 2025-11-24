"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase.client";

const supabase = supabaseBrowser();

/**
 * Bridges Supabase magic link fragments/query params into a stored session.
 * When a token is present, it stores the session, cleans up the URL, and
 * re-runs the server-side /login route so it can redirect based on roles.
 */
export default function LoginTokenBridge() {
  const router = useRouter();

  useEffect(() => {
    const processLoginFromUrl = async () => {
      if (typeof window === "undefined") {
        return;
      }

      const currentUrl = new URL(window.location.href);
      const hash = window.location.hash ?? "";
      const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const hasMagicHash = Boolean(accessToken && refreshToken);
      const code = currentUrl.searchParams.get("code");

      if (!hasMagicHash && !code) {
        return;
      }

      try {
        if (hasMagicHash && accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (error) {
            console.error("[login] setSession failed", error);
            return;
          }
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            console.error("[login] exchangeCodeForSession failed", error);
            return;
          }
        }

        window.history.replaceState({}, "", "/login");
        router.replace("/login");
      } catch (err) {
        console.error("[login] failed to process Supabase login URL", err);
      }
    };

    void processLoginFromUrl();
  }, [router]);

  return null;
}

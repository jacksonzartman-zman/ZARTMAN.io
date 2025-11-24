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
      const hashString = window.location.hash ?? "";
      const hashParams = new URLSearchParams(hashString.replace(/^#/, ""));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const code = currentUrl.searchParams.get("code");
      const hasMagicHash = Boolean(accessToken && refreshToken);

      console.log("[login bridge] current URL:", currentUrl.toString());
      console.log("[login bridge] hash:", hashString);
      console.log("[login bridge] access_token present?", Boolean(accessToken));
      console.log("[login bridge] refresh_token present?", Boolean(refreshToken));
      console.log("[login bridge] code param:", code);

      if (!hasMagicHash && !code) {
        console.log("[login bridge] no magic-link tokens found, skipping");
        return;
      }

      try {
        if (hasMagicHash && accessToken && refreshToken) {
          console.log("[login bridge] calling supabase.auth.setSession");
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (error) {
            console.error("[login bridge] setSession failed", error);
            return;
          }
        } else if (code) {
          console.log("[login bridge] calling supabase.auth.exchangeCodeForSession");
          const { error } = await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            console.error("[login bridge] exchangeCodeForSession failed", error);
            return;
          }
        }

        console.log(
          "[login bridge] session established on client, cleaning URL and reloading /login",
        );
        window.history.replaceState({}, "", "/login");
        router.replace("/login");
      } catch (err) {
        console.error("[login bridge] failed to process Supabase login URL", err);
      }
    };

    void processLoginFromUrl();
  }, [router]);

  return null;
}

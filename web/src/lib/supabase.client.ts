"use client";

import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Create a browser supabase client if env vars are present. Otherwise
// export a small stub to avoid build-time errors in environments where
// env vars aren't available (CI / preview builds).
export const supabase = ((): any => {
  if (!URL || !KEY || !/^https?:\/\//i.test(URL)) {
    return {
      auth: {
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signInWithOtp: async () => ({ error: { message: 'Supabase not configured' } })
      }
    };
  }
  return createClient(URL, KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
})();

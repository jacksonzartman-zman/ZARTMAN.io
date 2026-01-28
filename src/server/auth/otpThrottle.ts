const OTP_THROTTLE_WINDOW_MS = 60_000;

type OtpThrottleStore = Map<string, number>;

function getStore(): OtpThrottleStore {
  const g = globalThis as unknown as { __zartmanOtpThrottle?: OtpThrottleStore };
  if (!g.__zartmanOtpThrottle) {
    g.__zartmanOtpThrottle = new Map<string, number>();
  }
  return g.__zartmanOtpThrottle;
}

function normalizeEmailKey(email: string): string {
  return email.trim().toLowerCase();
}

function maybePruneStore(store: OtpThrottleStore) {
  // Prevent unbounded growth if many unique emails hit this instance.
  if (store.size < 10_000) return;

  const cutoff = Date.now() - 5 * 60_000;
  for (const [key, lastAt] of store.entries()) {
    if (lastAt < cutoff) store.delete(key);
  }
}

export function checkOtpThrottle(email: string): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const key = normalizeEmailKey(email);
  const store = getStore();
  const lastAttemptAt = store.get(key) ?? null;
  if (!lastAttemptAt) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const elapsedMs = Date.now() - lastAttemptAt;
  if (elapsedMs >= OTP_THROTTLE_WINDOW_MS) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const remainingMs = OTP_THROTTLE_WINDOW_MS - elapsedMs;
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) };
}

export function markOtpAttempt(email: string): void {
  const key = normalizeEmailKey(email);
  const store = getStore();
  store.set(key, Date.now());
  maybePruneStore(store);
}


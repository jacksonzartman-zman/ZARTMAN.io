import { createHmac, timingSafeEqual } from "node:crypto";

type PreviewTokenPayloadV1 = {
  v: 1;
  uid: string;
  b: string;
  p: string;
  exp: number; // unix seconds
};

type PreviewTokenPayloadV2 = {
  v: 2;
  uid: string;
  b: string;
  p: string;
  exp: number; // unix seconds
  // Optional metadata to help server resolve alternate storage keys.
  qid?: string; // quote id
  fn?: string; // filename hint
};

type PreviewTokenPayload = PreviewTokenPayloadV1 | PreviewTokenPayloadV2;

function base64UrlEncode(input: string | Uint8Array): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecodeToString(input: string): string | null {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return null;
  const padded = raw.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((raw.length + 3) % 4);
  try {
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function getTokenSecret(): string {
  const explicit = process.env.CAD_PREVIEW_TOKEN_SECRET;
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit.trim();
  }
  // Fallback: ensures local/dev still works without extra env wiring.
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof fallback === "string" && fallback.trim()) {
    return fallback.trim();
  }
  throw new Error("missing_CAD_PREVIEW_TOKEN_SECRET");
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePath(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.replace(/^\/+/, "");
}

export function signPreviewToken(input: {
  userId: string;
  bucket: string;
  path: string;
  exp: number; // unix seconds
  quoteId?: string | null;
  filename?: string | null;
}): string {
  const base: Omit<PreviewTokenPayloadV2, "v"> = {
    uid: normalizeId(input.userId),
    b: normalizeId(input.bucket),
    p: normalizePath(input.path),
    exp: typeof input.exp === "number" && Number.isFinite(input.exp) ? input.exp : 0,
    qid: normalizeId(input.quoteId),
    fn: normalizeId(input.filename),
  };
  if (!base.qid) delete (base as any).qid;
  if (!base.fn) delete (base as any).fn;

  const payload: PreviewTokenPayload =
    base.qid || base.fn ? { v: 2, ...base } : { v: 1, ...base };

  if (!payload.uid || !payload.b || !payload.p || payload.exp <= 0) {
    throw new Error("invalid_preview_token_payload");
  }

  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sig = createHmac("sha256", getTokenSecret()).update(payloadB64).digest();
  const sigB64 = base64UrlEncode(sig);
  return `${payloadB64}.${sigB64}`;
}

export function verifyPreviewToken(input: {
  token: string;
  userId: string;
  bucket: string;
  path: string;
  nowSeconds?: number;
}): { ok: true; payload: PreviewTokenPayload } | { ok: false; reason: string } {
  const raw = typeof input.token === "string" ? input.token.trim() : "";
  const parts = raw.split(".");
  if (parts.length !== 2) return { ok: false, reason: "token_format" };
  const [payloadB64, sigB64] = parts as [string, string];
  if (!payloadB64 || !sigB64) return { ok: false, reason: "token_format" };

  const expectedSig = createHmac("sha256", getTokenSecret()).update(payloadB64).digest();
  const expectedSigB64 = base64UrlEncode(expectedSig);

  // Constant-time compare to avoid oracle-y differences.
  try {
    const a = Buffer.from(expectedSigB64);
    const b = Buffer.from(sigB64);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: "token_signature" };
    }
  } catch {
    return { ok: false, reason: "token_signature" };
  }

  const decoded = base64UrlDecodeToString(payloadB64);
  if (!decoded) return { ok: false, reason: "token_payload_decode" };

  let payload: PreviewTokenPayload | null = null;
  try {
    payload = JSON.parse(decoded) as PreviewTokenPayload;
  } catch {
    payload = null;
  }

  if (!payload || (payload.v !== 1 && payload.v !== 2)) {
    return { ok: false, reason: "token_payload" };
  }

  const now =
    typeof input.nowSeconds === "number" && Number.isFinite(input.nowSeconds)
      ? input.nowSeconds
      : Math.floor(Date.now() / 1000);

  if (!payload.exp || payload.exp < now) return { ok: false, reason: "token_expired" };

  const uid = normalizeId(payload.uid);
  const bkt = normalizeId(payload.b);
  const pth = normalizePath(payload.p);

  if (!uid || !bkt || !pth) return { ok: false, reason: "token_payload" };

  if (uid !== normalizeId(input.userId)) return { ok: false, reason: "token_user_mismatch" };
  if (bkt !== normalizeId(input.bucket)) return { ok: false, reason: "token_bucket_mismatch" };
  if (pth !== normalizePath(input.path)) return { ok: false, reason: "token_path_mismatch" };

  const qid = payload.v === 2 ? normalizeId((payload as PreviewTokenPayloadV2).qid) : "";
  const fn = payload.v === 2 ? normalizeId((payload as PreviewTokenPayloadV2).fn) : "";
  const normalizedPayload: PreviewTokenPayload =
    payload.v === 2
      ? {
          ...(payload as PreviewTokenPayloadV2),
          uid,
          b: bkt,
          p: pth,
          ...(qid ? { qid } : {}),
          ...(fn ? { fn } : {}),
        }
      : { ...(payload as PreviewTokenPayloadV1), uid, b: bkt, p: pth };
  return { ok: true, payload: normalizedPayload };
}

export function verifyPreviewTokenForUser(input: {
  token: string;
  userId: string;
  nowSeconds?: number;
}): { ok: true; payload: PreviewTokenPayload } | { ok: false; reason: string } {
  const raw = typeof input.token === "string" ? input.token.trim() : "";
  const parts = raw.split(".");
  if (parts.length !== 2) return { ok: false, reason: "token_format" };
  const [payloadB64, sigB64] = parts as [string, string];
  if (!payloadB64 || !sigB64) return { ok: false, reason: "token_format" };

  const expectedSig = createHmac("sha256", getTokenSecret()).update(payloadB64).digest();
  const expectedSigB64 = base64UrlEncode(expectedSig);

  // Constant-time compare to avoid oracle-y differences.
  try {
    const a = Buffer.from(expectedSigB64);
    const b = Buffer.from(sigB64);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: "token_signature" };
    }
  } catch {
    return { ok: false, reason: "token_signature" };
  }

  const decoded = base64UrlDecodeToString(payloadB64);
  if (!decoded) return { ok: false, reason: "token_payload_decode" };

  let payload: PreviewTokenPayload | null = null;
  try {
    payload = JSON.parse(decoded) as PreviewTokenPayload;
  } catch {
    payload = null;
  }

  if (!payload || (payload.v !== 1 && payload.v !== 2)) {
    return { ok: false, reason: "token_payload" };
  }

  const now =
    typeof input.nowSeconds === "number" && Number.isFinite(input.nowSeconds)
      ? input.nowSeconds
      : Math.floor(Date.now() / 1000);

  if (!payload.exp || payload.exp < now) return { ok: false, reason: "token_expired" };

  const uid = normalizeId(payload.uid);
  const bkt = normalizeId(payload.b);
  const pth = normalizePath(payload.p);

  if (!uid || !bkt || !pth) return { ok: false, reason: "token_payload" };
  if (uid !== normalizeId(input.userId)) return { ok: false, reason: "token_user_mismatch" };

  const qid = payload.v === 2 ? normalizeId((payload as PreviewTokenPayloadV2).qid) : "";
  const fn = payload.v === 2 ? normalizeId((payload as PreviewTokenPayloadV2).fn) : "";
  const normalizedPayload: PreviewTokenPayload =
    payload.v === 2
      ? {
          ...(payload as PreviewTokenPayloadV2),
          uid,
          b: bkt,
          p: pth,
          ...(qid ? { qid } : {}),
          ...(fn ? { fn } : {}),
        }
      : { ...(payload as PreviewTokenPayloadV1), uid, b: bkt, p: pth };
  return { ok: true, payload: normalizedPayload };
}


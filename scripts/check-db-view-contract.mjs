/**
 * DB "schema contract" guardrail:
 * Verifies that certain public views expose required columns before deploy.
 *
 * Implementation note:
 * We intentionally avoid DB-side helpers/functions and instead rely on PostgREST
 * validating selected columns at request time. This works even when the view is
 * empty (no rows), and requires only SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  // Local/dev environments (including some CI sandboxes) may not have secrets.
  // We skip rather than hard-fail; real deploy pipelines should set these vars.
  console.warn(
    "[db contract] skipped (missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY)",
  );
  process.exit(0);
}
if (typeof fetch !== "function") {
  throw new Error(
    "Global fetch is not available. Use Node 18+ to run this script.",
  );
}

const API_BASE = SUPABASE_URL.replace(/\/+$/, "");

const CONTRACTS = [
  {
    schema: "public",
    view: "quotes_with_uploads",
    required: [
      "id",
      "upload_id",
      "status",
      "customer_name",
      "customer_email",
      "company",
      "file_name",
      "file_names",
      "upload_file_names",
      "file_count",
      "upload_file_count",
      "assigned_supplier_email",
      "assigned_supplier_name",
      "awarded_supplier_id",
      "awarded_bid_id",
      "awarded_at",
      "upload_name",
      "created_at",
      "updated_at",
    ],
  },
  {
    schema: "public",
    view: "admin_quotes_inbox",
    required: [
      "id",
      "upload_id",
      "created_at",
      "status",
      "customer_name",
      "customer_email",
      "company",
      "file_name",
      "file_names",
      "upload_file_names",
      "file_count",
      "upload_file_count",
      "upload_name",
      "awarded_at",
      "awarded_supplier_id",
      "awarded_bid_id",
      "bid_count",
      "latest_bid_at",
      "has_awarded_bid",
      "awarded_supplier_name",
    ],
  },
];

function restHeaders() {
  // PostgREST requires both headers in practice:
  // - apikey (for rate limits / project association)
  // - Authorization Bearer (for actual auth)
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    Accept: "application/json",
  };
}

function isMissingColumnError(payload) {
  const msg =
    (payload && typeof payload === "object" && "message" in payload
      ? payload.message
      : null) ?? null;
  const details =
    (payload && typeof payload === "object" && "details" in payload
      ? payload.details
      : null) ?? null;

  const combined = `${msg ?? ""}\n${details ?? ""}`.toLowerCase();
  return (
    combined.includes("column") &&
    (combined.includes("does not exist") || combined.includes("unknown column"))
  );
}

function isMissingRelationError(payload) {
  const msg =
    (payload && typeof payload === "object" && "message" in payload
      ? payload.message
      : null) ?? null;
  const details =
    (payload && typeof payload === "object" && "details" in payload
      ? payload.details
      : null) ?? null;

  const combined = `${msg ?? ""}\n${details ?? ""}`.toLowerCase();
  return (
    combined.includes("could not find the") ||
    combined.includes("not found") ||
    combined.includes("does not exist")
  );
}

async function checkColumnExists({ schema, view, column }) {
  const qualified = `${schema}.${view}`;
  const url = new URL(`${API_BASE}/rest/v1/${view}`);
  url.searchParams.set("select", column);
  url.searchParams.set("limit", "1");

  const res = await fetch(url, { headers: restHeaders() });
  if (res.ok) {
    // Even empty results are a success signal: the column exists.
    await res.arrayBuffer().catch(() => null);
    return { ok: true, qualified, column };
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // ignore
  }

  if (res.status === 404 || isMissingRelationError(payload)) {
    return {
      ok: false,
      qualified,
      column,
      fatal: true,
      message:
        payload?.message ??
        `View "${qualified}" is not accessible via PostgREST (status ${res.status}).`,
    };
  }

  if (res.status === 400 && isMissingColumnError(payload)) {
    return { ok: false, qualified, column, missing: true };
  }

  return {
    ok: false,
    qualified,
    column,
    fatal: true,
    message:
      payload?.message ??
      `Unexpected PostgREST error for "${qualified}.${column}" (status ${res.status}).`,
  };
}

function createLimiter(maxConcurrent) {
  let active = 0;
  const queue = [];

  const runNext = () => {
    if (active >= maxConcurrent) return;
    const next = queue.shift();
    if (!next) return;
    active++;
    next()
      .catch(() => null)
      .finally(() => {
        active--;
        runNext();
      });
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push(async () => {
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        }
      });
      runNext();
    });
}

async function checkContract(contract) {
  const limit = createLimiter(6);

  const results = await Promise.all(
    contract.required.map((column) =>
      limit(() => checkColumnExists({ ...contract, column })),
    ),
  );

  const missing = results
    .filter((r) => r.ok === false && r.missing)
    .map((r) => r.column)
    .sort();

  const fatals = results.filter((r) => r.ok === false && r.fatal);

  return {
    qualified: `${contract.schema}.${contract.view}`,
    missing,
    fatals,
  };
}

async function main() {
  const checks = await Promise.all(CONTRACTS.map(checkContract));

  const fatalErrors = checks.flatMap((c) =>
    c.fatals.map((f) => ({ qualified: c.qualified, message: f.message })),
  );
  const missingByView = checks.filter((c) => c.missing.length > 0);

  if (fatalErrors.length > 0) {
    console.error("\nDB view contract check failed (fatal error).\n");
    for (const err of fatalErrors) {
      console.error(`- ${err.qualified}: ${err.message}`);
    }
    console.error("");
    process.exitCode = 1;
    return;
  }

  if (missingByView.length > 0) {
    console.error("\nDB view contract check failed (missing columns).\n");
    for (const view of missingByView) {
      console.error(`- ${view.qualified}`);
      console.error(`  Missing: ${view.missing.join(", ")}`);
    }
    console.error("");
    process.exitCode = 1;
    return;
  }

  // Quiet success (keeps build output clean).
}

await main();


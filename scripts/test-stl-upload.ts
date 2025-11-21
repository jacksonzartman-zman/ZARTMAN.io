import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";

const DEFAULT_ENV_PATH = resolve(process.cwd(), ".env.local");
const MB = 1024 * 1024;

type UploadHandlerPayload = {
  success: boolean;
  message?: string;
  uploadId?: string;
  quoteId?: string | null;
};

type ScenarioConfig = {
  label: string;
  fileName: string;
  sizeBytes: number;
  expectSuccess: boolean;
};

const SCENARIOS: ScenarioConfig[] = [
  {
    label: "valid-stl",
    fileName: "debug-valid.stl",
    sizeBytes: 12 * MB,
    expectSuccess: true,
  },
  {
    label: "invalid-extension",
    fileName: "debug-invalid.txt",
    sizeBytes: 2 * MB,
    expectSuccess: false,
  },
  {
    label: "oversized-stl",
    fileName: "debug-huge.stl",
    sizeBytes: 26 * MB,
    expectSuccess: false,
  },
];

function loadEnvFile(path: string) {
  if (!existsSync(path)) {
    return;
  }

  const contents = readFileSync(path, "utf8");
  contents.split(/\r?\n/).forEach((line) => {
    if (!line || line.trim().startsWith("#")) return;
    const idx = line.indexOf("=");
    if (idx <= 0) return;
    const key = line.slice(0, idx).trim();
    if (!key) return;
    const value = line.slice(idx + 1).trim();
    if (key in process.env) return;
    process.env[key] = value;
  });
}

async function runScenario(
  label: string,
  sizeBytes: number,
  fileName: string,
  expectSuccess: boolean,
  postHandler: (req: NextRequest) => Promise<Response>,
) {
  const buffer = Buffer.alloc(sizeBytes, 42);
  const file = new File([buffer], fileName, { type: "" }); // simulate iOS Safari (empty type)

  const formData = new FormData();
  formData.append("file", file);
  formData.append("name", `STL Harness (${label})`);
  formData.append("email", "stl-harness@example.com");
  formData.append("company", "Cursor QA");
  formData.append("notes", `Scenario: ${label}`);

  const request = new NextRequest("http://localhost/api/upload", {
    method: "POST",
    body: formData,
  });

  const response = await postHandler(request);
  const payload = await parseJson(response, label);

  logScenario(label, response.status, payload);
  assertHasBooleanSuccess(label, payload);

  if (expectSuccess && !payload.success) {
    throw new Error(
      `[${label}] Expected success but received failure: ${payload.message}`,
    );
  }

  if (!expectSuccess && payload.success) {
    throw new Error(
      `[${label}] Expected failure but handler reported success.`,
    );
  }

  if (!payload.message || !payload.message.trim()) {
    throw new Error(`[${label}] Handler did not include a readable message.`);
  }
}

async function parseJson(response: Response, label: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(
      `[${label}] Response was not valid JSON (status ${response.status}): ${error instanceof Error ? error.message : error}`,
    );
  }
}

function logScenario(label: string, status: number, body: unknown) {
  console.log(
    `[${label}]`,
    JSON.stringify(
      {
        status,
        ok: status >= 200 && status < 300,
        body,
      },
      null,
      2,
    ),
  );
}

function assertHasBooleanSuccess(
  label: string,
  payload: unknown,
): asserts payload is UploadHandlerPayload {
  if (typeof payload.success !== "boolean") {
    throw new Error(`[${label}] Payload missing success flag.`);
  }
}

async function run() {
  loadEnvFile(DEFAULT_ENV_PATH);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in .env.local or the environment before running this script.",
    );
  }

  const { POST } = await import("../src/app/api/upload/route");

  for (const scenario of SCENARIOS) {
    await runScenario(
      scenario.label,
      scenario.sizeBytes,
      scenario.fileName,
      scenario.expectSuccess,
      POST,
    );
  }

  console.log("All STL harness scenarios completed successfully.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

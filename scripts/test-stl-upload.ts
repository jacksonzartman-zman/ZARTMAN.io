import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";

const DEFAULT_ENV_PATH = resolve(process.cwd(), ".env.local");
const FILE_SIZE_BYTES = 12 * 1024 * 1024; // ~12 MB

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

async function run() {
  loadEnvFile(DEFAULT_ENV_PATH);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in .env.local or the environment before running this script.",
    );
  }

  const { POST } = await import("../src/app/api/upload/route");

  const buffer = Buffer.alloc(FILE_SIZE_BYTES, 42);
  const file = new File([buffer], "3DBenchy.stl", { type: "" });

  const formData = new FormData();
  formData.append("file", file);
  formData.append("name", "STL Debug Harness");
  formData.append("email", "stl-debug@example.com");
  formData.append("company", "Cursor QA");
  formData.append(
    "notes",
    "Synthetic STL upload to confirm storage + DB pipeline.",
  );

  const request = new NextRequest("http://localhost/api/upload", {
    method: "POST",
    body: formData,
  });

  const response = await POST(request);
  const payload = await response.json();

  console.log(
    JSON.stringify(
      {
        status: response.status,
        ok: response.ok,
        body: payload,
      },
      null,
      2,
    ),
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

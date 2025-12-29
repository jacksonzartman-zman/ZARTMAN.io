import { spawnSync } from "node:child_process";

const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
if (!projectRef) {
  console.error(
    [
      "Missing SUPABASE_PROJECT_REF.",
      "",
      "Usage:",
      "  SUPABASE_PROJECT_REF=<prod project ref> npm run supabase:deploy:step-to-stl",
      "",
      "This script intentionally requires the ref to prevent deploying to the wrong Supabase project.",
    ].join("\n"),
  );
  process.exit(1);
}

const result = spawnSync(
  "supabase",
  ["functions", "deploy", "step-to-stl", "--project-ref", projectRef],
  { stdio: "inherit" },
);

process.exit(result.status ?? 1);


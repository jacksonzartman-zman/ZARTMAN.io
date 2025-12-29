import { spawnSync } from "node:child_process";

const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
if (!projectRef) {
  console.error(
    [
      "Missing SUPABASE_PROJECT_REF.",
      "",
      "Usage:",
      "  SUPABASE_PROJECT_REF=<prod project ref> npm run supabase:link",
      "",
      "Tip: the project ref is the subdomain of your Supabase host, e.g.",
      "  qslztdkptpklopyedkfd.supabase.co -> qslztdkptpklopyedkfd",
    ].join("\n"),
  );
  process.exit(1);
}

const result = spawnSync("supabase", ["link", "--project-ref", projectRef], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);


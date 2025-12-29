import { spawn } from "node:child_process";

const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
if (!projectRef) {
  console.error(
    [
      "Missing SUPABASE_PROJECT_REF.",
      "",
      "Usage:",
      "  SUPABASE_PROJECT_REF=<prod project ref> npm run supabase:logs:step-to-stl",
    ].join("\n"),
  );
  process.exit(1);
}

// Prefer a bounded log fetch (non-tail) for safety.
const args = ["functions", "logs", "step-to-stl", "--project-ref", projectRef, "--limit", "200"];

const child = spawn("supabase", args, { stdio: "inherit" });

// Safety net: if the CLI tails indefinitely on your version, stop after 20s.
const timeoutMs = 20_000;
const timer = setTimeout(() => {
  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
}, timeoutMs);

child.on("exit", (code) => {
  clearTimeout(timer);
  process.exit(code ?? 1);
});


import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const WORKSPACE_ROOT = process.cwd();
const SRC_ROOT = path.join(WORKSPACE_ROOT, "src");

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "coverage",
]);

function isCodeFile(p) {
  return p.endsWith(".ts") || p.endsWith(".tsx");
}

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      yield* walk(full);
    } else if (ent.isFile()) {
      if (isCodeFile(full)) yield full;
    }
  }
}

function applyFixes(text) {
  let out = text;

  // 1) Fix multiline method chains:
  //    supabaseServer\n  .from(...)  -> supabaseServer()\n  .from(...)
  out = out.replace(/(\bsupabaseServer)([ \t]*\n[ \t]*\.)/g, "$1()$2");

  // 2) Fix nullish coalescing defaults:
  //    x ?? supabaseServer  -> x ?? supabaseServer()
  out = out.replace(/\?\?\s*supabaseServer\b(?!\s*\()/g, "?? supabaseServer()");

  // 3) Fix object property passing:
  //    { supabase: supabaseServer } -> { supabase: supabaseServer() }
  out = out.replace(/supabase:\s*supabaseServer\b(?!\s*\()/g, "supabase: supabaseServer()");

  // 4) Fix simple assignments (common pattern):
  //    const supabase = supabaseServer; -> const supabase = supabaseServer();
  out = out.replace(/=\s*supabaseServer\b(?!\s*\()/g, "= supabaseServer()");

  return out;
}

async function main() {
  let scanned = 0;
  let changed = 0;
  const changedFiles = [];

  for await (const filePath of walk(SRC_ROOT)) {
    scanned += 1;
    const before = await readFile(filePath, "utf8");
    const after = applyFixes(before);
    if (after !== before) {
      changed += 1;
      changedFiles.push(path.relative(WORKSPACE_ROOT, filePath));
      await writeFile(filePath, after, "utf8");
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        scanned,
        changed,
        changedFiles,
      },
      null,
      2,
    ),
  );
}

await main();


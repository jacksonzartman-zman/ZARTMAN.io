import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TARGET_DIR = path.join(ROOT, "src");
const FORBIDDEN = "quotes.email";

// Keep this conservative: scan typical source/text extensions only.
const TEXT_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".scss",
  ".json",
  ".md",
]);

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

function findAllOccurrences(content, needle) {
  const out = [];
  let idx = content.indexOf(needle);
  while (idx !== -1) {
    out.push(idx);
    idx = content.indexOf(needle, idx + needle.length);
  }
  return out;
}

function indexToLineCol(content, index) {
  // 1-based line/col
  let line = 1;
  let lastLineStart = 0;
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10) {
      line++;
      lastLineStart = i + 1;
    }
  }
  const col = index - lastLineStart + 1;
  return { line, col };
}

async function main() {
  const hits = [];

  for await (const filePath of walk(TARGET_DIR)) {
    const ext = path.extname(filePath);
    if (!TEXT_EXTS.has(ext)) continue;

    const content = await readFile(filePath, "utf8");
    if (!content.includes(FORBIDDEN)) continue;

    for (const idx of findAllOccurrences(content, FORBIDDEN)) {
      const { line, col } = indexToLineCol(content, idx);
      hits.push({
        filePath: path.relative(ROOT, filePath),
        line,
        col,
      });
    }
  }

  if (hits.length > 0) {
    console.error(
      `\nForbidden string "${FORBIDDEN}" found under src/. ` +
        `Schema uses "customer_email" instead.\n`
    );
    for (const hit of hits) {
      console.error(`- ${hit.filePath}:${hit.line}:${hit.col}`);
    }
    console.error("");
    process.exitCode = 1;
    return;
  }

  // Quiet success (keeps build output clean).
}

await main();

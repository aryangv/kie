// Load a .env file into process.env as early as possible.
//
// This module is imported *first* by the entrypoints (server, daemon) so that
// any module which reads process.env at import time sees the values. It uses
// Node's built-in env-file parser (Node 20.12+/22) — no dependency.
//
// Search order: $KIE_ENV_FILE, then <project root>/.env, then <cwd>/.env.
// A missing or malformed file is ignored (env stays as-is).

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function candidatePaths(): string[] {
  const paths: string[] = [];
  if (process.env.KIE_ENV_FILE) paths.push(process.env.KIE_ENV_FILE);
  // This file compiles to dist/env.js, so "../.env" is the project root.
  const here = dirname(fileURLToPath(import.meta.url));
  paths.push(join(here, "..", ".env"));
  paths.push(join(process.cwd(), ".env"));
  return paths;
}

const loadEnvFile = (process as { loadEnvFile?: (path: string) => void }).loadEnvFile;

for (const path of candidatePaths()) {
  if (!existsSync(path)) continue;
  try {
    loadEnvFile?.(path);
  } catch {
    // Malformed .env — leave process.env untouched rather than crash on boot.
  }
  break;
}

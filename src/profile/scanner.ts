// Scan local code roots to discover the user's stack. We read dependency
// manifests (not source files, for speed and signal-to-noise) and emit one
// signal per (repo, manifest, dependency). The walk is shallow-ish: it skips
// node_modules / vendor / .git and caps depth so a big tree stays fast.
//
// The per-manifest parsers below are pure (string -> dependency names) so they
// can be unit-tested without touching the filesystem.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "vendor", "target", ".venv",
  "venv", "__pycache__", ".next", ".cache", "coverage", ".turbo",
]);
const MAX_DEPTH = 4;

export interface ScannedSignal {
  repoPath: string;
  manifest: string;
  dependency: string;
  /** Language implied by the manifest, e.g. "typescript", "python". */
  language: string;
}

/** Manifests we know how to parse, mapped to their default language. Languages
 * are spelled to match GitHub's `language` field (lowercased) so the fit
 * classifier lines up profile languages with a repo's language — note C# is
 * "c#", not "csharp". */
const MANIFEST_LANG: Record<string, string> = {
  "package.json": "javascript",
  "requirements.txt": "python",
  "pyproject.toml": "python",
  "go.mod": "go",
  "Cargo.toml": "rust",
  Gemfile: "ruby",
  "composer.json": "php",
  "pubspec.yaml": "dart",
  "pom.xml": "java",
  "build.gradle": "java",
  "build.gradle.kts": "kotlin",
};

/** True for manifest filenames matched by suffix rather than exact name. */
function isManifestFile(entry: string): boolean {
  return entry in MANIFEST_LANG || entry.endsWith(".csproj");
}

export function scanRoots(roots: string[]): ScannedSignal[] {
  const signals: ScannedSignal[] = [];
  for (const root of roots) {
    walk(root, 0, signals);
  }
  return signals;
}

function walk(dir: string, depth: number, out: ScannedSignal[]) {
  if (depth > MAX_DEPTH) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // unreadable dir — skip
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
      walk(full, depth + 1, out);
    } else if (isManifestFile(entry)) {
      try {
        parseManifest(dir, entry, out);
      } catch {
        // ignore malformed manifests
      }
    }
  }
}

function parseManifest(repoPath: string, manifest: string, out: ScannedSignal[]) {
  const content = readFileSync(join(repoPath, manifest), "utf8");
  let language = MANIFEST_LANG[manifest] ?? (manifest.endsWith(".csproj") ? "c#" : "unknown");
  let deps: string[] = [];

  if (manifest === "package.json") {
    const parsed = parsePackageJson(content);
    deps = parsed.deps;
    if (parsed.isTypescript) language = "typescript";
  } else if (manifest === "requirements.txt") {
    deps = parseRequirementsTxt(content);
  } else if (manifest === "pyproject.toml") {
    deps = parsePyproject(content);
  } else if (manifest === "Cargo.toml") {
    deps = parseCargoToml(content);
  } else if (manifest === "go.mod") {
    deps = parseGoMod(content);
  } else if (manifest === "Gemfile") {
    deps = parseGemfile(content);
  } else if (manifest === "composer.json") {
    deps = parseComposerJson(content);
  } else if (manifest === "pubspec.yaml") {
    deps = parsePubspec(content);
  } else if (manifest === "pom.xml") {
    deps = parsePomXml(content);
  } else if (manifest === "build.gradle" || manifest === "build.gradle.kts") {
    deps = parseGradle(content);
  } else if (manifest.endsWith(".csproj")) {
    deps = parseCsproj(content);
  }

  for (const dep of deps) {
    // Key by the full manifest directory so two repos that share a folder
    // basename aren't collapsed into one (which undercounted dependency reach).
    out.push({ repoPath, manifest, dependency: dep, language });
  }
}

// ---- pure manifest parsers ------------------------------------------------

/** package.json dependencies + devDependencies (lowercased), plus a TS flag. */
export function parsePackageJson(content: string): { deps: string[]; isTypescript: boolean } {
  const json = JSON.parse(content) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const names = Object.keys({ ...json.dependencies, ...json.devDependencies }).map((n) =>
    n.toLowerCase(),
  );
  return { deps: unique(names), isTypescript: names.includes("typescript") };
}

/** Package names from a requirements.txt (drops version specifiers, comments, flags). */
export function parseRequirementsTxt(content: string): string[] {
  const deps: string[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    const name = pyName(line);
    if (name) deps.push(name);
  }
  return unique(deps);
}

/**
 * pyproject.toml: handles both PEP-621 (`[project] dependencies = [...]` and
 * `[project.optional-dependencies]`) and Poetry (`[tool.poetry...dependencies]`
 * tables). Section-aware so it never mistakes `name`/`version` for a dependency.
 */
export function parsePyproject(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const deps: string[] = [];
  let section = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sec = line.match(/^\s*\[([^\]]+)\]/);
    if (sec) {
      section = sec[1].trim();
      continue;
    }

    // PEP-621: [project] dependencies = ["fastapi>=1", ...] (may span lines).
    if (section === "project" && /^\s*dependencies\s*=\s*\[/.test(line)) {
      const { text, end } = collectArray(lines, i);
      for (const s of quotedStrings(text)) {
        const name = pyName(s);
        if (name) deps.push(name);
      }
      i = end;
      continue;
    }

    // PEP-621: [project.optional-dependencies] has `group = ["pkg", ...]` arrays.
    if (section === "project.optional-dependencies" && /=\s*\[/.test(line)) {
      const { text, end } = collectArray(lines, i);
      for (const s of quotedStrings(text)) {
        const name = pyName(s);
        if (name) deps.push(name);
      }
      i = end;
      continue;
    }

    // Poetry: any [tool.poetry...dependencies] table -> `name = ...` keys.
    if (section.startsWith("tool.poetry") && /dependencies$/.test(section)) {
      const m = line.match(/^\s*["']?([A-Za-z0-9_.\-]+)["']?\s*=/);
      if (m) {
        const name = m[1].toLowerCase();
        if (name !== "python") deps.push(name);
      }
    }
  }
  return unique(deps);
}

/**
 * Cargo.toml: collect keys only under dependency tables ([dependencies],
 * [dev-dependencies], [build-dependencies], [target.*.dependencies]). Handles
 * both `serde = "1"` and `tokio = { version = "1", features = [...] }`.
 */
export function parseCargoToml(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const deps: string[] = [];
  let inDeps = false;

  for (const line of lines) {
    const sec = line.match(/^\s*\[([^\]]+)\]/);
    if (sec) {
      const name = sec[1].trim();
      // [dependencies.serde] style: the trailing segment IS the dependency name;
      // the lines under it are that dep's config, not new deps.
      const sub = name.match(/(?:^|\.)(?:dev-|build-)?dependencies\.([A-Za-z0-9_-]+)$/);
      if (sub) {
        deps.push(sub[1].toLowerCase());
        inDeps = false;
        continue;
      }
      inDeps =
        name === "dependencies" ||
        /(^|\.)(dev-dependencies|build-dependencies|dependencies)$/.test(name);
      continue;
    }
    if (!inDeps) continue;
    const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*=/);
    if (m) deps.push(m[1].toLowerCase());
  }
  return unique(deps);
}

/**
 * go.mod: extract dependency module paths from `require` (single or block) and
 * reduce each to its importable base name (strip the `/vN` major suffix, take
 * the last path segment) so the taxonomy can match it — e.g.
 * github.com/gin-gonic/gin -> gin, github.com/labstack/echo/v4 -> echo.
 * Indirect (transitive) requires are skipped as noise.
 */
export function parseGoMod(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const deps: string[] = [];
  let inBlock = false;

  for (const raw of lines) {
    let line = raw.trim();
    if (line.startsWith("require (")) {
      inBlock = true;
      line = line.slice("require (".length).trim();
      if (!line) continue;
    } else if (inBlock && line === ")") {
      inBlock = false;
      continue;
    }
    const single = line.match(/^require\s+(\S+)\s+v\S+/);
    if (single) {
      if (!/\/\/\s*indirect/.test(line)) deps.push(goPkgName(single[1]));
      continue;
    }
    if (inBlock) {
      const m = line.match(/^(\S+)\s+v\S+/);
      if (m && !/\/\/\s*indirect/.test(line)) deps.push(goPkgName(m[1]));
    }
  }
  return unique(deps);
}

/** Gemfile (Ruby): `gem "name"` declarations, ignoring comments and options. */
export function parseGemfile(content: string): string[] {
  const deps: string[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^gem\s+["']([^"']+)["']/);
    if (m) deps.push(m[1].toLowerCase());
  }
  return unique(deps);
}

/** composer.json (PHP): require + require-dev keys ("vendor/package"), minus the
 * `php` pin and `ext-*`/`lib-*` platform pseudo-packages. */
export function parseComposerJson(content: string): string[] {
  const json = JSON.parse(content) as {
    require?: Record<string, string>;
    "require-dev"?: Record<string, string>;
  };
  const names = Object.keys({ ...json.require, ...json["require-dev"] })
    .map((n) => n.toLowerCase())
    .filter((n) => n !== "php" && !n.startsWith("ext-") && !n.startsWith("lib-"));
  return unique(names);
}

/** pubspec.yaml (Dart/Flutter): top-level keys under `dependencies:` and
 * `dev_dependencies:` (the 2-space-indented entries; nested keys are deeper). */
export function parsePubspec(content: string): string[] {
  const deps: string[] = [];
  let inDeps = false;
  for (const raw of content.split(/\r?\n/)) {
    if (/^[A-Za-z0-9_]+\s*:/.test(raw)) {
      inDeps = /^(dependencies|dev_dependencies)\s*:/.test(raw);
      continue;
    }
    if (!inDeps) continue;
    const m = raw.match(/^\s{2}([A-Za-z0-9_]+)\s*:/);
    if (m && m[1].toLowerCase() !== "sdk") deps.push(m[1].toLowerCase());
  }
  return unique(deps);
}

/** pom.xml (Maven): every `<artifactId>` value. Includes plugin artifactIds as
 * harmless noise — they simply don't match the taxonomy. */
export function parsePomXml(content: string): string[] {
  const deps: string[] = [];
  for (const m of content.matchAll(/<artifactId>\s*([^<\s][^<]*?)\s*<\/artifactId>/g)) {
    deps.push(m[1].trim().toLowerCase());
  }
  return unique(deps);
}

/** build.gradle[.kts] (Gradle): the artifact id from `"group:artifact:version"`
 * dependency strings (the middle coordinate). */
export function parseGradle(content: string): string[] {
  const deps: string[] = [];
  for (const m of content.matchAll(/["']([\w.\-]+):([\w.\-]+)(?::[\w.\-]+)?["']/g)) {
    deps.push(m[2].toLowerCase());
  }
  return unique(deps);
}

/** *.csproj (.NET): `<PackageReference Include="Name" .../>` package names. */
export function parseCsproj(content: string): string[] {
  const deps: string[] = [];
  for (const m of content.matchAll(/<PackageReference\s+[^>]*Include\s*=\s*"([^"]+)"/g)) {
    deps.push(m[1].toLowerCase());
  }
  return unique(deps);
}

// ---- helpers --------------------------------------------------------------

function unique(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))];
}

/** Strip a Python requirement spec down to the bare package name (lowercased). */
function pyName(spec: string): string {
  // e.g. "fastapi[all]>=0.1 ; python_version>'3'" -> "fastapi"
  const name = spec.trim().split(/[<>=!~;,\s\[\](){}]/)[0];
  return name.toLowerCase();
}

/** Reduce a Go module path to its importable base name. */
function goPkgName(modPath: string): string {
  const noMajor = modPath.replace(/\/v\d+$/, "");
  return (noMajor.split("/").pop() ?? noMajor).toLowerCase();
}

/** Strings inside single/double quotes within a blob. */
function quotedStrings(text: string): string[] {
  return [...text.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

/**
 * From a line that opens a `[` array, accumulate text across lines until the
 * brackets balance. Returns the joined text and the index of the last line
 * consumed (so the caller can advance past a multi-line array).
 */
function collectArray(lines: string[], start: number): { text: string; end: number } {
  let depth = 0;
  let started = false;
  const parts: string[] = [];
  let i = start;
  for (; i < lines.length; i++) {
    const line = lines[i];
    parts.push(line);
    for (const ch of line) {
      if (ch === "[") {
        depth++;
        started = true;
      } else if (ch === "]") {
        depth--;
      }
    }
    if (started && depth <= 0) break;
  }
  return { text: parts.join("\n"), end: Math.min(i, lines.length - 1) };
}

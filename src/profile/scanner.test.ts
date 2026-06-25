import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePackageJson,
  parseRequirementsTxt,
  parsePyproject,
  parseCargoToml,
  parseGoMod,
  parseGemfile,
  parseComposerJson,
  parsePubspec,
  parsePomXml,
  parseGradle,
  parseCsproj,
} from "./scanner.js";

test("parsePackageJson merges deps + devDeps and flags typescript", () => {
  const { deps, isTypescript } = parsePackageJson(
    JSON.stringify({
      dependencies: { react: "18", "@angular/core": "17" },
      devDependencies: { typescript: "5", vitest: "1" },
    }),
  );
  assert.deepEqual([...deps].sort(), ["@angular/core", "react", "typescript", "vitest"]);
  assert.equal(isTypescript, true);
});

test("parseRequirementsTxt strips versions, comments, and flags", () => {
  const txt = ["# comment", "fastapi>=0.100", "pydantic==2.5", "-r other.txt", "requests", ""].join("\n");
  assert.deepEqual(parseRequirementsTxt(txt), ["fastapi", "pydantic", "requests"]);
});

test("parsePyproject reads PEP-621 dependencies array (multi-line)", () => {
  const toml = [
    "[project]",
    'name = "myapp"',
    'version = "0.1.0"',
    "dependencies = [",
    '  "fastapi>=0.100",',
    '  "sqlalchemy",',
    "]",
    "",
    "[project.optional-dependencies]",
    'dev = ["pytest", "ruff"]',
  ].join("\n");
  const deps = parsePyproject(toml);
  // name/version must NOT leak in as deps.
  assert.ok(!deps.includes("name") && !deps.includes("version"));
  for (const d of ["fastapi", "sqlalchemy", "pytest", "ruff"]) {
    assert.ok(deps.includes(d), `expected ${d}`);
  }
});

test("parsePyproject reads Poetry tables and skips the python pin", () => {
  const toml = [
    "[tool.poetry.dependencies]",
    'python = "^3.11"',
    'django = "^5.0"',
    'requests = { version = "^2.31" }',
    "[tool.poetry.group.dev.dependencies]",
    'pytest = "*"',
  ].join("\n");
  const deps = parsePyproject(toml);
  assert.ok(!deps.includes("python"), "python pin excluded");
  for (const d of ["django", "requests", "pytest"]) assert.ok(deps.includes(d), d);
});

test("parseCargoToml collects only dependency tables, incl. sub-table form", () => {
  const toml = [
    "[package]",
    'name = "mycrate"',
    'version = "0.1.0"',
    'edition = "2021"',
    "[dependencies]",
    'serde = "1.0"',
    'tokio = { version = "1", features = ["full"] }',
    "[dev-dependencies]",
    'criterion = "0.5"',
    "[dependencies.reqwest]",
    'version = "0.12"',
  ].join("\n");
  const deps = parseCargoToml(toml);
  for (const noise of ["name", "version", "edition", "features"]) {
    assert.ok(!deps.includes(noise), `${noise} must not be a dep`);
  }
  for (const d of ["serde", "tokio", "criterion", "reqwest"]) assert.ok(deps.includes(d), d);
});

test("parseGoMod reduces module paths to base names and skips indirect", () => {
  const mod = [
    "module github.com/me/app",
    "go 1.22",
    "require (",
    "  github.com/gin-gonic/gin v1.9.1",
    "  github.com/labstack/echo/v4 v4.11.0",
    "  golang.org/x/sync v0.5.0 // indirect",
    ")",
    "require github.com/spf13/cobra v1.8.0",
  ].join("\n");
  const deps = parseGoMod(mod);
  assert.ok(deps.includes("gin"), "gin-gonic/gin -> gin");
  assert.ok(deps.includes("echo"), "echo/v4 -> echo (major suffix stripped)");
  assert.ok(deps.includes("cobra"), "single-line require parsed");
  assert.ok(!deps.includes("sync"), "indirect dependency skipped");
});

test("parseGemfile reads gem declarations, ignores comments", () => {
  const gemfile = [
    "source 'https://rubygems.org'",
    "# web",
    'gem "rails", "~> 7.1"',
    "gem 'pg', '>= 1.0'",
    "gem 'rspec', group: :test",
  ].join("\n");
  const deps = parseGemfile(gemfile);
  assert.deepEqual(deps.sort(), ["pg", "rails", "rspec"]);
});

test("parseComposerJson reads require/require-dev, drops php + ext-* pseudo", () => {
  const json = JSON.stringify({
    require: { php: "^8.2", "laravel/framework": "^11", "ext-json": "*", "guzzlehttp/guzzle": "^7" },
    "require-dev": { "phpunit/phpunit": "^11" },
  });
  const deps = parseComposerJson(json);
  assert.ok(!deps.includes("php") && !deps.includes("ext-json"));
  for (const d of ["laravel/framework", "guzzlehttp/guzzle", "phpunit/phpunit"]) {
    assert.ok(deps.includes(d), d);
  }
});

test("parsePubspec reads top-level deps under dependencies/dev_dependencies", () => {
  const yaml = [
    "name: myapp",
    "dependencies:",
    "  flutter:",
    "    sdk: flutter",
    "  http: ^1.1.0",
    "  riverpod: ^2.4.0",
    "dev_dependencies:",
    "  flutter_test:",
    "    sdk: flutter",
    "  test: ^1.24.0",
    "flutter:",
    "  uses-material-design: true",
  ].join("\n");
  const deps = parsePubspec(yaml);
  for (const d of ["flutter", "http", "riverpod", "flutter_test", "test"]) {
    assert.ok(deps.includes(d), d);
  }
  assert.ok(!deps.includes("sdk"), "nested sdk: key excluded");
  assert.ok(!deps.includes("uses-material-design"), "non-dep section excluded");
});

test("parsePomXml extracts artifactIds", () => {
  const pom = [
    "<project>",
    "  <dependencies>",
    "    <dependency>",
    "      <groupId>org.springframework.boot</groupId>",
    "      <artifactId>spring-boot-starter-web</artifactId>",
    "    </dependency>",
    "    <dependency>",
    "      <groupId>org.junit.jupiter</groupId>",
    "      <artifactId>junit-jupiter</artifactId>",
    "    </dependency>",
    "  </dependencies>",
    "</project>",
  ].join("\n");
  const deps = parsePomXml(pom);
  assert.ok(deps.includes("spring-boot-starter-web"));
  assert.ok(deps.includes("junit-jupiter"));
});

test("parseGradle extracts the artifact coordinate from dependency strings", () => {
  const gradle = [
    "dependencies {",
    "  implementation 'org.springframework.boot:spring-boot-starter-web:3.2.0'",
    '  testImplementation("org.junit.jupiter:junit-jupiter:5.10.0")',
    "  implementation 'com.squareup.okhttp3:okhttp:4.12.0'",
    "}",
  ].join("\n");
  const deps = parseGradle(gradle);
  for (const d of ["spring-boot-starter-web", "junit-jupiter", "okhttp"]) {
    assert.ok(deps.includes(d), d);
  }
});

test("parseCsproj reads PackageReference Include names", () => {
  const csproj = [
    "<Project Sdk=\"Microsoft.NET.Sdk\">",
    "  <ItemGroup>",
    '    <PackageReference Include="Serilog" Version="3.1.1" />',
    '    <PackageReference Include="xunit" Version="2.6.0" />',
    "  </ItemGroup>",
    "</Project>",
  ].join("\n");
  const deps = parseCsproj(csproj);
  assert.deepEqual(deps.sort(), ["serilog", "xunit"]);
});

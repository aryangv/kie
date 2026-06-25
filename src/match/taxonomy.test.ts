import { test } from "node:test";
import assert from "node:assert/strict";
import { categorize, categorizeDependency, LANGUAGE_AGNOSTIC } from "./taxonomy.js";

test("an animation library is 'animation', not mislabeled a UI framework", () => {
  // The regression: framer-motion/Motion carries the "react" topic, which used
  // to tag it ui-framework -> "replaces" against a React stack.
  const cats = categorize({
    name: "motion",
    topics: ["react", "animation", "javascript"],
    description: "A modern animation library for React and the web.",
  });
  assert.ok(cats.has("animation"), "should be tagged animation");
  assert.ok(!cats.has("ui-framework"), "a bare 'react' topic must not imply ui-framework");
});

test("animation deps resolve via name and dependency lookup", () => {
  assert.equal(categorizeDependency("gsap"), "animation");
  assert.equal(categorizeDependency("framer-motion"), "animation");
  assert.ok(categorize({ name: "react-spring" }).has("animation"));
});

test("a genuine component library still tags ui-framework via its description", () => {
  const cats = categorize({
    topics: ["react"],
    description: "An accessible React component library for building design systems.",
  });
  assert.ok(cats.has("ui-framework"), "'component library' phrasing keeps ui-framework");
});

test("design topics/keywords map to 'design', which is language-agnostic", () => {
  assert.ok(categorize({ topics: ["design-system"] }).has("design"));
  assert.ok(categorize({ description: "Design tokens and Figma sync." }).has("design"));
  assert.ok(LANGUAGE_AGNOSTIC.has("design"));
});

test("creative-coding / graphics signals map to 'creative'", () => {
  assert.ok(categorize({ name: "three" }).has("creative"));
  assert.ok(categorize({ topics: ["webgl"] }).has("creative"));
  assert.ok(categorize({ description: "A creative coding library for generative art." }).has("creative"));
});

test("the react/vue/svelte *dependency* still implies ui-framework", () => {
  assert.equal(categorizeDependency("react"), "ui-framework");
  assert.ok(categorize({ name: "vue" }).has("ui-framework"));
});

test("common cross-cutting deps now categorize instead of falling through", () => {
  const expected: Record<string, string> = {
    "next-auth": "auth",
    "react-hook-form": "forms",
    "@tanstack/react-query": "data-fetching",
    graphql: "graphql",
    "socket.io": "realtime",
    redis: "caching",
    bullmq: "queue",
    stripe: "payments",
    nodemailer: "email",
    i18next: "i18n",
    d3: "data-viz",
    electron: "desktop",
    "react-native": "mobile",
    phaser: "game-engine",
    astro: "static-site",
    "monaco-editor": "rich-text-editor",
    dayjs: "date-time",
  };
  for (const [dep, cat] of Object.entries(expected)) {
    assert.equal(categorizeDependency(dep), cat, `${dep} -> ${cat}`);
  }
});

test("new categories also resolve via topics and description keywords", () => {
  assert.ok(categorize({ topics: ["oauth"] }).has("auth"));
  assert.ok(categorize({ description: "A charting library for dashboards." }).has("data-viz"));
  assert.ok(categorize({ description: "Build a cross-platform desktop app." }).has("desktop"));
  assert.ok(categorize({ description: "A GraphQL server with subscriptions." }).has("graphql"));
});

test("an uncategorizable repo still yields no categories (stays 'uncertain')", () => {
  assert.equal(categorize({ name: "widgetizer", description: "A thing that does stuff." }).size, 0);
});

test("new-ecosystem deps (Ruby/PHP/Java/C#/Dart) map to categories", () => {
  const expected: Record<string, string> = {
    rails: "web-framework",            // Ruby
    rspec: "testing",
    "laravel/framework": "web-framework", // PHP (composer key)
    "doctrine/orm": "orm",
    "spring-boot-starter-web": "web-framework", // Java
    "junit-jupiter": "testing",
    xunit: "testing",                  // C#
    "microsoft.entityframeworkcore": "orm",
    flutter: "ui-framework",           // Dart
    riverpod: "state-management",
  };
  for (const [dep, cat] of Object.entries(expected)) {
    assert.equal(categorizeDependency(dep), cat, `${dep} -> ${cat}`);
  }
});

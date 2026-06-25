// Heuristic category taxonomy. Both the profile builder (what categories does
// your stack already cover?) and the fit classifier (what does this tool do?)
// map raw signals — dependency names, GitHub topics, description keywords — onto
// a shared set of categories. This is intentionally a seed list: it errs toward
// recognizing common tools and labels everything else "uncategorized", which the
// fit classifier treats conservatively.

/** Categories where a language mismatch does NOT make a tool irrelevant. */
export const LANGUAGE_AGNOSTIC = new Set([
  "editor",
  "cli",
  "devops",
  "ci",
  "container",
  "database",
  "ai-tool",
  "mcp",
  "terminal",
  "shell",
  "infra",
  "monitoring",
  "documentation",
  "notes",
  "search",
  "productivity",
  "git",
  "version-manager",
  "design", // design work (systems, tokens, prototyping) spans every stack
]);

/** Dependency / package name -> category. Lowercased keys. */
const DEP_CATEGORY: Record<string, string> = {
  // web frameworks
  react: "ui-framework", "react-dom": "ui-framework", vue: "ui-framework",
  svelte: "ui-framework", "@angular/core": "ui-framework", "solid-js": "ui-framework",
  next: "web-framework", nuxt: "web-framework", express: "web-framework",
  fastify: "web-framework", koa: "web-framework", "@nestjs/core": "web-framework",
  flask: "web-framework", django: "web-framework", fastapi: "web-framework",
  gin: "web-framework", echo: "web-framework", axum: "web-framework", "actix-web": "web-framework",
  // state management
  redux: "state-management", zustand: "state-management", jotai: "state-management",
  mobx: "state-management", pinia: "state-management",
  // bundlers / build
  webpack: "bundler", vite: "bundler", rollup: "bundler", esbuild: "bundler",
  parcel: "bundler", turbopack: "bundler",
  // testing
  jest: "testing", vitest: "testing", mocha: "testing", ava: "testing",
  pytest: "testing", playwright: "e2e-testing", cypress: "e2e-testing",
  // linting / formatting
  eslint: "linter", prettier: "formatter", biome: "linter", ruff: "linter",
  black: "formatter", flake8: "linter",
  // orm / db clients
  prisma: "orm", typeorm: "orm", sequelize: "orm", "drizzle-orm": "orm",
  sqlalchemy: "orm", mongoose: "orm", "better-sqlite3": "database",
  // http clients
  axios: "http-client", got: "http-client", "node-fetch": "http-client",
  requests: "http-client", httpx: "http-client",
  // css
  tailwindcss: "css", "styled-components": "css", sass: "css",
  // animation / motion (frontend; "react" topic alone no longer implies UI)
  "framer-motion": "animation", motion: "animation", gsap: "animation",
  "react-spring": "animation", "@react-spring/web": "animation",
  animejs: "animation", popmotion: "animation", "lottie-web": "animation",
  // creative coding / graphics / 3d
  three: "creative", "@react-three/fiber": "creative", "pixi.js": "creative",
  p5: "creative", konva: "creative", fabric: "creative",
  // design tooling / tokens
  "style-dictionary": "design",
  // validation
  zod: "validation", yup: "validation", joi: "validation", pydantic: "validation",
  // cli frameworks
  commander: "cli", yargs: "cli", oclif: "cli", click: "cli", cobra: "cli",
  // ai / ml
  openai: "ai-tool", "@anthropic-ai/sdk": "ai-tool", langchain: "ai-tool",
  "@modelcontextprotocol/sdk": "mcp", transformers: "ml", torch: "ml",
  tensorflow: "ml", numpy: "data", pandas: "data",
  // logging
  winston: "logging", pino: "logging", loguru: "logging",

  // ---- Ruby ----
  rails: "web-framework", sinatra: "web-framework", puma: "web-framework",
  rspec: "testing", minitest: "testing", rubocop: "linter",
  activerecord: "orm", sequel: "orm", faraday: "http-client",
  // ---- PHP (composer "vendor/package" keys) ----
  "laravel/framework": "web-framework", "symfony/symfony": "web-framework",
  "slim/slim": "web-framework", "symfony/console": "cli",
  "phpunit/phpunit": "testing", "pestphp/pest": "testing",
  "guzzlehttp/guzzle": "http-client", "doctrine/orm": "orm",
  "monolog/monolog": "logging",
  // ---- Java / Kotlin (maven artifactId / gradle artifact) ----
  "spring-boot-starter-web": "web-framework", "spring-webmvc": "web-framework",
  ktor: "web-framework", junit: "testing", "junit-jupiter": "testing",
  testng: "testing", mockito: "testing", "mockito-core": "testing",
  hibernate: "orm", "hibernate-core": "orm", slf4j: "logging",
  "logback-classic": "logging", okhttp: "http-client", retrofit: "http-client",
  // ---- C# / .NET ----
  xunit: "testing", nunit: "testing", dapper: "orm",
  "microsoft.entityframeworkcore": "orm", serilog: "logging",
  fluentvalidation: "validation", "microsoft.aspnetcore.app": "web-framework",
  // ---- Dart / Flutter ----
  flutter: "ui-framework", dio: "http-client", http: "http-client",
  provider: "state-management", riverpod: "state-management",
  flutter_riverpod: "state-management", bloc: "state-management",
  flutter_bloc: "state-management",

  // ---- cross-cutting application concerns (mostly JS/Python ecosystems) ----
  // auth
  passport: "auth", "next-auth": "auth", "@auth/core": "auth", lucia: "auth",
  jsonwebtoken: "auth", jose: "auth", bcrypt: "auth", bcryptjs: "auth", argon2: "auth",
  "@clerk/nextjs": "auth", authlib: "auth", "python-jose": "auth", passlib: "auth",
  pyjwt: "auth",
  // forms
  "react-hook-form": "forms", formik: "forms", "final-form": "forms",
  "vee-validate": "forms", "@tanstack/react-form": "forms",
  // data fetching / server state
  "react-query": "data-fetching", "@tanstack/react-query": "data-fetching",
  swr: "data-fetching", "@apollo/client": "data-fetching", urql: "data-fetching",
  "react-relay": "data-fetching",
  // graphql
  graphql: "graphql", "@apollo/server": "graphql", "apollo-server": "graphql",
  "graphql-yoga": "graphql", mercurius: "graphql", "type-graphql": "graphql",
  "strawberry-graphql": "graphql", ariadne: "graphql",
  // realtime / websocket
  "socket.io": "realtime", "socket.io-client": "realtime", ws: "realtime",
  // caching
  redis: "caching", ioredis: "caching", "node-cache": "caching", memcached: "caching",
  // queue / background jobs
  bullmq: "queue", bull: "queue", kafkajs: "queue", amqplib: "queue",
  celery: "queue", kombu: "queue", rq: "queue",
  // payments
  stripe: "payments", "@stripe/stripe-js": "payments", braintree: "payments",
  razorpay: "payments",
  // email
  nodemailer: "email", resend: "email", "@sendgrid/mail": "email", postmark: "email",
  // i18n
  i18next: "i18n", "react-i18next": "i18n", "react-intl": "i18n", "vue-i18n": "i18n",
  // data viz / charts
  d3: "data-viz", "chart.js": "data-viz", recharts: "data-viz", plotly: "data-viz",
  echarts: "data-viz", victory: "data-viz", "@visx/visx": "data-viz",
  matplotlib: "data-viz", seaborn: "data-viz", bokeh: "data-viz",
  // desktop
  electron: "desktop", "@tauri-apps/api": "desktop", "@tauri-apps/cli": "desktop",
  // mobile
  "react-native": "mobile", expo: "mobile", "@ionic/react": "mobile",
  "@capacitor/core": "mobile",
  // game
  phaser: "game-engine", "matter-js": "game-engine", babylonjs: "game-engine",
  // static site / SSG
  astro: "static-site", gatsby: "static-site", "@11ty/eleventy": "static-site",
  "@docusaurus/core": "static-site", vitepress: "static-site",
  // rich text / editors
  prosemirror: "rich-text-editor", "@tiptap/core": "rich-text-editor",
  slate: "rich-text-editor", lexical: "rich-text-editor", quill: "rich-text-editor",
  codemirror: "rich-text-editor", "monaco-editor": "rich-text-editor",
  // date / time
  dayjs: "date-time", "date-fns": "date-time", luxon: "date-time", moment: "date-time",
  pendulum: "date-time",
};

/** GitHub topic -> category. */
const TOPIC_CATEGORY: Record<string, string> = {
  // NB: a bare "react"/"vue"/"svelte" topic just means "works with React/…", not
  // "is a UI framework" — the whole ecosystem (animation, state, query, forms)
  // carries it. So we don't map those topics here; the *dependency* react/vue/…
  // still implies ui-framework (you render UI), and genuine component libraries
  // are caught by the description keyword below.
  // NB: a bare "framework" topic is too generic to imply web — don't map it.
  "web-framework": "web-framework", webframework: "web-framework",
  bundler: "bundler", "build-tool": "bundler",
  testing: "testing", "test-framework": "testing", e2e: "e2e-testing",
  linter: "linter", formatter: "formatter",
  orm: "orm", database: "database", sql: "database",
  cli: "cli", "command-line": "cli", terminal: "terminal", tui: "terminal",
  editor: "editor", ide: "editor",
  docker: "container", kubernetes: "infra", devops: "devops", "ci-cd": "ci",
  "machine-learning": "ml", "deep-learning": "ml", llm: "ai-tool", ai: "ai-tool",
  "artificial-intelligence": "ai-tool", agent: "ai-tool", mcp: "mcp",
  observability: "monitoring", monitoring: "monitoring", logging: "logging",
  documentation: "documentation", validation: "validation",
  "state-management": "state-management", css: "css", styling: "css",
  "http-client": "http-client", api: "api",
  // design / animation / creative
  animation: "animation", motion: "animation", animations: "animation",
  design: "design", "design-system": "design", "design-systems": "design",
  "design-tokens": "design", figma: "design", "ui-design": "design", ux: "design",
  "creative-coding": "creative", "generative-art": "creative", graphics: "creative",
  webgl: "creative", canvas: "creative", "3d": "creative", shaders: "creative",
  "image-generation": "creative", "video-editing": "creative",
  // cross-cutting application concerns
  authentication: "auth", oauth: "auth", jwt: "auth", sso: "auth",
  forms: "forms",
  "data-fetching": "data-fetching",
  graphql: "graphql",
  websocket: "realtime", websockets: "realtime", realtime: "realtime",
  cache: "caching", caching: "caching",
  "message-queue": "queue", "job-queue": "queue", "task-queue": "queue",
  payments: "payments", payment: "payments", stripe: "payments",
  email: "email", smtp: "email",
  i18n: "i18n", internationalization: "i18n", localization: "i18n",
  "data-visualization": "data-viz", dataviz: "data-viz", charts: "data-viz",
  electron: "desktop", tauri: "desktop", "desktop-app": "desktop",
  "react-native": "mobile", android: "mobile", ios: "mobile", mobile: "mobile",
  "game-engine": "game-engine", gamedev: "game-engine", "game-development": "game-engine",
  "static-site-generator": "static-site", ssg: "static-site",
  wysiwyg: "rich-text-editor", "rich-text-editor": "rich-text-editor", "code-editor": "rich-text-editor",
  datetime: "date-time",
};

/** Description keyword regex -> category (first match wins, ordered). */
const KEYWORD_CATEGORY: [RegExp, string][] = [
  [/\bweb framework\b/i, "web-framework"],
  [/\b(ui (?:library|framework|components?)|component library)\b/i, "ui-framework"],
  [/\b(test runner|testing framework|unit tests?)\b/i, "testing"],
  [/\bend.?to.?end\b/i, "e2e-testing"],
  [/\b(bundler|build tool)\b/i, "bundler"],
  [/\b(linter|lint)\b/i, "linter"],
  [/\b(formatter|code formatting)\b/i, "formatter"],
  [/\borm\b/i, "orm"],
  [/\b(database|sql|key.?value store)\b/i, "database"],
  [/\bcommand.?line\b/i, "cli"],
  [/\b(terminal|tui)\b/i, "terminal"],
  [/\b(editor|ide)\b/i, "editor"],
  [/\b(container|docker)\b/i, "container"],
  [/\b(kubernetes|infrastructure|terraform)\b/i, "infra"],
  [/\b(llm|language model|ai agent|gpt|prompt)\b/i, "ai-tool"],
  [/\bmodel context protocol\b/i, "mcp"],
  [/\bmachine learning\b/i, "ml"],
  [/\b(observability|monitoring|metrics|tracing)\b/i, "monitoring"],
  [/\b(logger|logging)\b/i, "logging"],
  [/\b(?:schema validation|validation)\b/i, "validation"],
  [/\bstate management\b/i, "state-management"],
  [/\b(css|styling|stylesheet)\b/i, "css"],
  [/\bhttp client\b/i, "http-client"],
  [/\b(animations?|motion design|micro.?interactions?)\b/i, "animation"],
  [/\b(design systems?|design tokens?|figma|wireframes?|prototyping tool)\b/i, "design"],
  [/\b(creative coding|generative art|image generation|video (?:editing|generation)|webgl|shaders?|3d graphics)\b/i, "creative"],
  [/\b(authentication|oauth\d?|single sign-on|json web tokens?)\b/i, "auth"],
  [/\bform (?:validation|state|builder|library|management)\b/i, "forms"],
  [/\b(data fetching|server state)\b/i, "data-fetching"],
  [/\bgraphql\b/i, "graphql"],
  [/\b(websockets?|real.?time)\b/i, "realtime"],
  [/\b(caching layer|in-memory cache|cache store)\b/i, "caching"],
  [/\b(message queue|job queue|task queue|background jobs?)\b/i, "queue"],
  [/\bpayments?\b/i, "payments"],
  [/\b(internationalization|localization|i18n)\b/i, "i18n"],
  [/\b(data visualization|charting library|charts?)\b/i, "data-viz"],
  [/\b(desktop app|cross-platform desktop)\b/i, "desktop"],
  [/\b(mobile app|react native)\b/i, "mobile"],
  [/\b(game engine|game development|gamedev)\b/i, "game-engine"],
  [/\bstatic site generator\b/i, "static-site"],
  [/\b(rich text editor|wysiwyg|code editor)\b/i, "rich-text-editor"],
];

export interface CategorizeInput {
  name?: string;
  topics?: string[];
  description?: string | null;
}

/** Map a dependency name to a category, if known. */
export function categorizeDependency(dep: string): string | undefined {
  return DEP_CATEGORY[dep.toLowerCase()];
}

/** Derive the set of categories a tool/repo covers from its signals. */
export function categorize(input: CategorizeInput): Set<string> {
  const cats = new Set<string>();
  if (input.name) {
    const c = DEP_CATEGORY[input.name.toLowerCase()];
    if (c) cats.add(c);
  }
  for (const topic of input.topics ?? []) {
    const c = TOPIC_CATEGORY[topic.toLowerCase()];
    if (c) cats.add(c);
  }
  if (input.description) {
    for (const [re, cat] of KEYWORD_CATEGORY) {
      if (re.test(input.description)) cats.add(cat);
    }
  }
  return cats;
}

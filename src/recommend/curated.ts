// A hand-picked list of broadly-useful tools to surface during initial setup —
// the kind of thing most developers benefit from regardless of stack (fast
// search, a fuzzy finder, a knowledge base, a git TUI). These are NOT discovered
// from the trend feed; they're a curated baseline.
//
// At setup we filter them against the user's living profile: if a tool's
// category is already covered (or the user has decided on it before), we say so
// instead of pitching it. Everything here is cross-platform.

import type { Store } from "../store/db.js";
import type { ProfileView } from "../profile/profile.js";

export interface CuratedTool {
  name: string;
  /** Repo "owner/name" when it's a GitHub project; omitted for apps. */
  repoRef?: string;
  url: string;
  /** Taxonomy-ish category; used to detect whether the user already covers it. */
  category: string;
  why: string;
}

export const CURATED: CuratedTool[] = [
  {
    name: "ripgrep",
    repoRef: "burntsushi/ripgrep",
    url: "https://github.com/BurntSushi/ripgrep",
    category: "search",
    why: "Extremely fast recursive code search — a drop-in, far quicker grep.",
  },
  {
    name: "fzf",
    repoRef: "junegunn/fzf",
    url: "https://github.com/junegunn/fzf",
    category: "search",
    why: "General-purpose fuzzy finder for files, history, branches — composes with everything.",
  },
  {
    name: "zoxide",
    repoRef: "ajeetdsouza/zoxide",
    url: "https://github.com/ajeetdsouza/zoxide",
    category: "terminal",
    why: "A smarter cd that learns your most-used directories and jumps to them.",
  },
  {
    name: "bat",
    repoRef: "sharkdp/bat",
    url: "https://github.com/sharkdp/bat",
    category: "terminal",
    why: "cat with syntax highlighting, line numbers, and git integration.",
  },
  {
    name: "lazygit",
    repoRef: "jesseduffield/lazygit",
    url: "https://github.com/jesseduffield/lazygit",
    category: "git",
    why: "A fast terminal UI for git — staging, rebasing, and branch work without memorizing flags.",
  },
  {
    name: "delta",
    repoRef: "dandavison/delta",
    url: "https://github.com/dandavison/delta",
    category: "git",
    why: "Syntax-highlighted, readable git diffs and blame in the terminal.",
  },
  {
    name: "gh (GitHub CLI)",
    repoRef: "cli/cli",
    url: "https://github.com/cli/cli",
    category: "devops",
    why: "Drive GitHub (PRs, issues, releases, gists) from the terminal.",
  },
  {
    name: "jq",
    repoRef: "jqlang/jq",
    url: "https://github.com/jqlang/jq",
    category: "cli",
    why: "Slice, filter, and transform JSON on the command line.",
  },
  {
    name: "mise",
    repoRef: "jdx/mise",
    url: "https://github.com/jdx/mise",
    category: "version-manager",
    why: "One tool to manage Node/Python/etc. versions and per-project env — replaces nvm/pyenv.",
  },
  {
    name: "Obsidian",
    url: "https://obsidian.md",
    category: "notes",
    why: "Local-first markdown knowledge base — great for design notes, snippets, and project docs.",
  },
];

export type StarterStatus = "recommend" | "covered" | "decided";

export interface StarterRec {
  tool: CuratedTool;
  status: StarterStatus;
  note: string;
}

/**
 * Filter the curated list against the profile. A tool whose category the user
 * already covers is reported as "covered"; one they've decided on before as
 * "decided"; everything else is a fresh "recommend".
 */
export function recommendStarters(store: Store, profile: ProfileView): StarterRec[] {
  return CURATED.map((tool) => {
    const decision = tool.repoRef ? store.getDecision(store.getToolByRef(tool.repoRef)?.id ?? -1) : undefined;
    if (decision) {
      return { tool, status: "decided" as const, note: `You previously marked this "${decision.decision}".` };
    }
    const incumbents = profile.categoryIncumbents.get(tool.category);
    if (incumbents && incumbents.length) {
      return {
        tool,
        status: "covered" as const,
        note: `You may already cover "${tool.category}" with ${[...new Set(incumbents)].join(", ")}.`,
      };
    }
    return { tool, status: "recommend" as const, note: tool.why };
  });
}

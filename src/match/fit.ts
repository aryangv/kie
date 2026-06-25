// Fit classification: given a tool and the living profile, decide whether it
//   - replaces    something you already use (same category already filled),
//   - complements your stack (relevant language/ecosystem, fills a gap), or
//   - irrelevant  to you (wrong language and not language-agnostic).
//
// This is a transparent heuristic, not a model. The MCP layer returns both this
// verdict AND the relevant profile slice, so the calling agent can narrate
// richer reasoning on top.

import type { FitVerdict, Tool } from "../types.js";
import type { ProfileView } from "../profile/profile.js";
import { categorize, LANGUAGE_AGNOSTIC } from "./taxonomy.js";

export type { FitVerdict };

export function classifyFit(tool: Tool, profile: ProfileView): FitVerdict {
  const toolCats = categorize({
    name: tool.name,
    topics: tool.topics,
    description: tool.description,
  });
  const lang = (tool.language ?? "").toLowerCase();
  const langKnown = lang.length > 0;
  const langInStack = langKnown && profile.languages.has(lang);
  const isAgnostic = [...toolCats].some((c) => LANGUAGE_AGNOSTIC.has(c));
  // No category signal at all -> any verdict below is a low-confidence guess.
  const uncertain = toolCats.size === 0;

  // With no profile yet, we can't judge replacement; treat as a complement but
  // say so honestly.
  if (profile.isEmpty) {
    return {
      verdict: "complements",
      reason:
        "Your profile is empty (no scanned projects yet), so I can't compare against " +
        "your stack. Run a profile scan to get a real fit verdict. On its face this " +
        "looks like a candidate to consider.",
      related: [],
      uncertain: true,
    };
  }

  // Does it overlap a category your stack already fills? -> replaces.
  const incumbents: string[] = [];
  for (const cat of toolCats) {
    const have = profile.categoryIncumbents.get(cat);
    if (have && have.length) incumbents.push(...have.map((h) => `${h} (${cat})`));
  }
  if (incumbents.length > 0) {
    const uniq = [...new Set(incumbents)];
    return {
      verdict: "replaces",
      reason:
        `You already cover this need with ${uniq.join(", ")}. ` +
        `${tool.name} occupies the same category, so it's a potential replacement rather ` +
        `than an addition — only worth switching if it's clearly better for you.`,
      related: uniq,
      uncertain,
    };
  }

  // Wrong language and not a language-agnostic tool -> irrelevant.
  if (langKnown && !langInStack && !isAgnostic && profile.languages.size > 0) {
    return {
      verdict: "irrelevant",
      reason:
        `${tool.name} is primarily ${tool.language}, which isn't in your stack ` +
        `(${[...profile.languages].join(", ")}). Not a fit unless you're branching out.`,
      related: [],
      uncertain,
    };
  }

  // Relevant ecosystem, no incumbent in its category -> complements.
  const langNote = langInStack
    ? `It's in your language (${tool.language}).`
    : isAgnostic
      ? "It's language-agnostic tooling that fits regardless of stack."
      : "It looks broadly applicable.";
  return {
    verdict: "complements",
    reason:
      `${langNote} It fills a gap your current stack doesn't obviously cover` +
      `${toolCats.size ? ` (${[...toolCats].join(", ")})` : ""}, so it could be a useful addition.`,
    related: [],
    uncertain,
  };
}

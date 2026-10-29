import { keysOf } from "./exhaustive";
import { MAX_LIST_LIMIT } from "./limits";

/** The parts of the Run section that carry a plain-language description. Each is the `data-help` of a paragraph in index.html, which the controls it describes name in `aria-describedby`. */
export type HelpKey = "count" | "list" | "list-limit" | "diagnose" | "covering" | "strength" | "one" | "explain";

/**
 * Every description the page shows, in one place. They are short, in plain words, and the first thing a reader meets under an operation's heading or beside its field, so none depends on a tooltip, and a screen reader reads each when its control gets focus.
 */
export const HELP: Readonly<Record<HelpKey, string>> = {
  count: "Counts the combinations that satisfy every rule, without listing them. It works on models far too large to list.",
  list: "Lists valid combinations in order, the first dimension changing slowest. It stops at the number you set, so a very large model cannot hang the page.",
  "list-limit": `The most combinations to show, from 0 to ${String(MAX_LIST_LIMIT)}. When there are more, the page says so.`,
  diagnose: "A dead value is one that no valid combination uses, because the rules rule it out wherever it could appear. Finding them shows where a rule is stricter than you meant.",
  covering:
    "A covering array is a short list of valid combinations that tests every interaction you care about without listing them all. Each row is a valid combination. The result is checked against the full set of valid combinations, when the model is small enough to do that, and the page reports whether it passed.",
  strength:
    "How many options at a time must be covered together. 1 means every single value appears in some row. 2, pairwise and the default, means every pair of values from any two dimensions appears together in some row. 3 means every triple, and so on. Combinations the rules make impossible are not required.",
  one: "Every valid combination has a fixed position, its index, counting from 0 in the order that List shows. Enter an index to see the combination at that position.",
  explain: "Pick a value for each dimension to describe one combination. Explain says whether it is valid and gives its index, or names each reason it is ruled out.",
};

/** Writes each description into the paragraph made for it. Throws for a paragraph that names a description there is none of, which is a defect in the page. */
export function fillHelp(root: ParentNode): void {
  for (const paragraph of root.querySelectorAll<HTMLElement>("[data-help]")) {
    const key = keysOf(HELP).find((known) => known === paragraph.dataset["help"]);
    if (key === undefined) throw new Error(`no description for ${String(paragraph.dataset["help"])}`);
    paragraph.textContent = HELP[key];
  }
}

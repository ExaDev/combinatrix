import { analyzeCommits } from "@semantic-release/commit-analyzer";
import { describe, expect, it } from "vitest";

import { commitTypes, releaseRules, unreleasedScopes } from "../release.config";

/** What commit-analyzer, with this repository's rules, decides the given commit messages release. */
async function releaseOf(...messages: readonly string[]): Promise<"major" | "minor" | "patch" | null> {
  return analyzeCommits(
    { preset: "conventionalcommits", releaseRules },
    { commits: messages.map((message, index) => ({ hash: String(index), message })), cwd: import.meta.dirname, logger: { log: () => undefined } },
  );
}

describe("release rules", () => {
  it.each(commitTypes)("releases a $type commit outside any unreleased scope at its level", async ({ type, release }) => {
    expect(await releaseOf(`${type}: change the package`)).toBe(release);
  });

  it.each(unreleasedScopes.flatMap((scope) => commitTypes.map(({ type }) => ({ scope, type }))))("does not release a $type($scope) commit", async ({ scope, type }) => {
    expect(await releaseOf(`${type}(${scope}): change something outside the package`)).toBeNull();
  });

  it("releases a breaking change even in an unreleased scope, since it states that the package breaks", async () => {
    expect(await releaseOf("feat(site)!: drop a page\n\nBREAKING CHANGE: the old page is gone")).toBe("major");
  });

  it("still releases when an unreleased commit sits beside a releasing one", async () => {
    expect(await releaseOf("feat(site): add a page", "fix: correct the package")).toBe("patch");
  });
});

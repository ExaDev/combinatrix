/** The part of semantic-release's commit-analyzer plugin, which ships no declarations, that the release rules test calls. */
declare module "@semantic-release/commit-analyzer" {
  export function analyzeCommits(
    pluginConfig: { readonly preset: string; readonly releaseRules: readonly object[] },
    context: {
      readonly commits: readonly { readonly hash: string; readonly message: string }[];
      readonly cwd: string;
      readonly logger: { readonly log: (...args: readonly unknown[]) => void };
    },
  ): Promise<"major" | "minor" | "patch" | null>;
}

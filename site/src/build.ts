import type { DisplayIdentity } from "@exadev/build-identity";

import { unreachable } from "./exhaustive";

/** How the footer names and describes the build the page came from. */
export interface BuildDescription {
  /** The link text: the release or predicted version with a leading "v", or the short commit hash. */
  readonly label: string;
  /** What the link points at, for its tooltip. */
  readonly title: string;
}

/** The length of the commit hash a title shows, the one git abbreviates to by default. */
const SHORT_COMMIT_LENGTH = 7;

/** A date as the reader writes it, in UTC so the same build reads the same everywhere. */
const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });

/** The footer's wording for a build identity. The label is the version for a release and for a build that will become one, and the commit hash otherwise; the title says which of the three it is, since a predicted version links to its commit, not to a release page that does not exist yet. */
export function describeBuild(identity: DisplayIdentity): BuildDescription {
  const date = DATE_FORMAT.format(new Date(identity.date));
  const commit = identity.commit.slice(0, SHORT_COMMIT_LENGTH);

  switch (identity.kind) {
    case "release":
      return { label: `v${identity.version}`, title: `Released on ${date}` };
    case "predicted":
      return { label: `v${identity.version}`, title: `Built from commit ${commit} on ${date}, which will release as v${identity.version}` };
    case "commit":
      return { label: identity.version, title: `Built from commit ${commit} on ${date}, which is not a release` };
    default:
      return unreachable(identity.kind);
  }
}

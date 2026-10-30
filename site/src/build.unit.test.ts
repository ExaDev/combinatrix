import type { DisplayIdentity } from "@exadev/build-identity";
import { describe, expect, it } from "vitest";

import { describeBuild } from "./build";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** An identity of the given kind, with the version a kind of that sort carries. */
function identity(kind: DisplayIdentity["kind"], version: string): DisplayIdentity {
  return { kind, version, url: "https://example.com/target", date: "2026-10-29T23:30:00+00:00", commit: COMMIT };
}

describe("describeBuild", () => {
  it("labels a release with its version and says it was released", () => {
    expect(describeBuild(identity("release", "2.0.3"))).toEqual({ label: "v2.0.3", title: "Released on 29 October 2026" });
  });

  it("labels a build that will become a release with the version it will have, and says it is not one yet", () => {
    const { label, title } = describeBuild(identity("predicted", "2.1.0"));

    expect(label).toBe("v2.1.0");
    expect(title).toBe("Built from commit 0123456 on 29 October 2026, which will release as v2.1.0");
  });

  it("labels any other build with its short commit hash and says it is not a release", () => {
    const { label, title } = describeBuild(identity("commit", "0123456"));

    expect(label).toBe("0123456");
    expect(title).toBe("Built from commit 0123456 on 29 October 2026, which is not a release");
  });

  it("reads the date in UTC, so a build near midnight reads the same everywhere", () => {
    expect(describeBuild({ ...identity("release", "1.0.0"), date: "2026-10-29T23:59:59-05:00" }).title).toBe("Released on 30 October 2026");
  });
});

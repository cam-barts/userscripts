// Validates every @match pattern in scripts/ AND styles/ against the
// WebExtension match-pattern grammar. eslint-plugin-userscripts has no
// pattern-validity rule and eslint never sees .user.css at all, so this test is
// the gate that would have caught `@match https://.windmill.dev/` (a leading
// dot makes the host invalid, so the pattern silently matches nothing).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = join(import.meta.dirname, "..");

// scheme://host/path - scheme *|http|https; host * or (*.)label(.label)*
// where labels are [A-Za-z0-9-] (no leading dot, * only as leftmost "*.");
// path must start with /.
const MATCH_PATTERN =
  /^(\*|https?):\/\/(\*|(\*\.)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*)(\/.*)$/;

function matchLines(file) {
  const src = readFileSync(file, "utf8");
  const out = [];
  for (const line of src.split("\n")) {
    const m = line.match(/^(?:\/\/\s*)?@match\s+(\S+)/);
    if (m) out.push(m[1]);
  }
  return out;
}

function filesIn(dir, ext) {
  return readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith(ext))
    .map((f) => join(ROOT, dir, f));
}

describe("@match patterns are valid in every script and style", () => {
  const files = [...filesIn("scripts", ".user.js"), ...filesIn("styles", ".user.css")];

  it("found files to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    it(file.split("/").pop(), () => {
      const patterns = matchLines(file);
      expect(patterns.length, "every script/style needs at least one @match").toBeGreaterThan(0);
      for (const p of patterns) {
        expect(p, `invalid match pattern: ${p}`).toMatch(MATCH_PATTERN);
      }
    });
  }

  it("rejects the historical Windmill bug shape", () => {
    expect("https://.windmill.dev/").not.toMatch(MATCH_PATTERN);
    expect("https://*.windmill.dev/*").toMatch(MATCH_PATTERN);
  });
});

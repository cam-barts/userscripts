import { join } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { loadUserscript } from "./load-userscript.js";

const SCRIPT_PATH = join(
  import.meta.dirname,
  "..",
  "scripts",
  "Jira Age Dynamic Highlighter.user.js",
);

describe("colorForFraction", () => {
  let hooks;

  beforeEach(() => {
    window.__TEST_HOOKS__ = {};
    loadUserscript(SCRIPT_PATH);
    hooks = window.__TEST_HOOKS__;
  });

  it("maps fraction 0 to pure green", () => {
    expect(hooks.colorForFraction(0)).toBe("rgba(0,255,0,0.5)");
  });

  it("maps fraction 1 to pure red", () => {
    expect(hooks.colorForFraction(1)).toBe("rgba(255,0,0,0.5)");
  });

  it("maps the midpoint to an even yellow-ish blend", () => {
    expect(hooks.colorForFraction(0.5)).toBe("rgba(128,128,0,0.5)");
  });

  it("clamps fractions below 0 to green", () => {
    expect(hooks.colorForFraction(-1)).toBe("rgba(0,255,0,0.5)");
  });

  it("clamps fractions above 1 to red", () => {
    expect(hooks.colorForFraction(2)).toBe("rgba(255,0,0,0.5)");
  });
});

import js from "@eslint/js";
import userscripts from "eslint-plugin-userscripts";

// Browser + userscript (FireMonkey/GM) globals used across scripts/*.user.js.
// Kept as a flat list rather than pulling in the `globals` package -
// this repo only has a handful of scripts and the set is stable.
const browserGlobals = {
  window: "readonly",
  document: "readonly",
  console: "readonly",
  fetch: "readonly",
  navigator: "readonly",
  MutationObserver: "readonly",
  CustomEvent: "readonly",
  localStorage: "readonly",
  sessionStorage: "readonly",
  alert: "readonly",
  confirm: "readonly",
  prompt: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  XMLHttpRequest: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  Blob: "readonly",
  FileReader: "readonly",
  Node: "readonly",
  Element: "readonly",
  HTMLElement: "readonly",
  Intl: "readonly",
  crypto: "readonly",
  structuredClone: "readonly",
  performance: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  location: "readonly",
  NodeFilter: "readonly",
  KeyboardEvent: "readonly",
  Event: "readonly",
  // Userscript (FireMonkey / GM) globals - see @grant in each script's metadata
  GM: "readonly",
  GM_getValue: "readonly",
  GM_setValue: "readonly",
  GM_deleteValue: "readonly",
  GM_listValues: "readonly",
  GM_registerMenuCommand: "readonly",
  GM_unregisterMenuCommand: "readonly",
  GM_xmlhttpRequest: "readonly",
  GM_notification: "readonly",
  GM_openInTab: "readonly",
  GM_setClipboard: "readonly",
  GM_addStyle: "readonly",
  unsafeWindow: "readonly",
  // Cross-script global: Confluence Menu Base assigns window.FireMonkeyMenu,
  // which @require'd extensions reference as a bare identifier (same realm).
  FireMonkeyMenu: "readonly",
};

export default [
  {
    files: ["scripts/**/*.user.js"],
    plugins: {
      userscripts,
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: browserGlobals,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...userscripts.configs.recommended.rules,
      // Metadata/correctness gate, not a style crusade.
      "no-unused-vars": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // Vendored script - don't hold it to our metadata rules.
    files: ["scripts/GitHub Commit Labels.user.js"],
    rules: {
      "userscripts/no-invalid-metadata": "off",
      "userscripts/align-attributes": "off",
      "userscripts/metadata-spacing": "off",
      "userscripts/better-use-match": "off",
      "userscripts/require-download-url": "off",
      "userscripts/use-homepage-and-url": "off",
      "no-unused-vars": "off",
      "no-empty": "off",
    },
  },
];

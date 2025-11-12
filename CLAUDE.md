# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a collection of **FireMonkey user scripts** (`.user.js`) and **user styles** (`.user.css`) for Firefox. FireMonkey is a browser extension that manages both JavaScript user scripts and CSS user styles.

### Key Characteristics

- **No build process**: Scripts are directly executable JavaScript files with special metadata headers
- **No package.json**: This is not a Node.js project; scripts run in the browser via FireMonkey
- **Version-controlled distribution**: Raw GitHub URLs serve as auto-update sources for FireMonkey
- **Standalone scripts**: Each script is independent, except for the Confluence Menu system (see Architecture)

## FireMonkey Documentation

For help writing FireMonkey scripts, including API reference, metadata fields, and examples, consult the official documentation:

**https://erosman.github.io/firemonkey/src/content/help.html**

This resource covers:
- Complete metadata block reference (`@grant`, `@match`, `@run-at`, etc.)
- FireMonkey API methods (GM.*, GM_* functions)
- Script execution contexts and timing
- Storage APIs and cross-script communication

## File Structure

```
scripts/          # User scripts (.user.js) - JavaScript that runs on web pages
styles/           # User styles (.user.css) - CSS that modifies web page appearance
```

## Script Metadata Format

Every user script **must** include a metadata block at the top:

```javascript
// ==UserScript==
// @name         Script Name
// @version      0.1
// @description  What this script does
// @author       cam-barts
// @match        https://example.com/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Script%20Name.user.js
// @downloadURL  https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/Script%20Name.user.js
// ==/UserScript==
```

**Important metadata fields:**
- `@match`: URL patterns where the script runs (supports wildcards)
- `@grant`: FireMonkey API permissions (`none`, `GM.getValue`, `GM_registerMenuCommand`, etc.)
- `@require`: Dependencies on other scripts (used by Confluence Menu extensions)
- `@updateURL` / `@downloadURL`: Must point to the **raw GitHub URL** with URL-encoded spaces (`%20`)

### Style Metadata Format

User styles use CSS comment syntax:

```css
/* ==UserStyle==
@name        Style Name
@version     1.0
@author      cam-barts
@match       https://example.com/*
@updateURL   https://raw.githubusercontent.com/cam-barts/userscripts/main/styles/Style%20Name.user.css
@downloadURL https://raw.githubusercontent.com/cam-barts/userscripts/main/styles/Style%20Name.user.css
==/UserStyle== */
```

## Architecture: Confluence Menu System

The Confluence scripts use a **base + extensions** architecture:

1. **Base Script**: `Confluence Menu Base.user.js`
   - Creates a global `window.FireMonkeyMenu` API
   - Provides `registerCommand()` method for adding menu buttons
   - Lazy-loads a floating menu UI on first command registration

2. **Extension Scripts**: `Confluence Menu *.user.js`
   - Include `@require Confluence Menu Base` in metadata
   - Check for `window.FireMonkeyMenu` availability before proceeding
   - Call `FireMonkeyMenu.registerCommand()` to add their functionality

**When creating new Confluence scripts:**
- Follow the extension pattern: check for base script availability
- Use `FireMonkeyMenu.registerCommand({ enabled: true, name: '...', callback: fn })`
- Include helpful error messages if base script is missing

## Development Commands

There are **no build, lint, or test commands** - this repository contains ready-to-use scripts.

### Testing Scripts

1. **Install FireMonkey** in Firefox
2. **Drag and drop** the `.user.js` or `.user.css` file into Firefox
3. **Navigate** to a matching URL (per `@match` patterns)
4. **Verify** functionality by interacting with the page

### URL Encoding for Raw Links

When adding `@updateURL` and `@downloadURL`:
- Replace spaces in filenames with `%20`
- Example: `My Script.user.js` → `My%20Script.user.js`

### Version Updates

**Automatic Version Incrementing:**
This repository has a GitHub Action that automatically increments version numbers when scripts are modified. When you push changes to `main`:
- Modified `.user.js` and `.user.css` files have their `@version` automatically incremented
- The patch/minor version is bumped (e.g., `0.4` → `0.5`, `1.6.2` → `1.6.3`)
- README.md is also updated with the new version number
- Changes are committed with `[skip-version]` to prevent infinite loops

**To skip auto-increment:** Include `[skip-version]` in your commit message if you've already manually updated the version.

**Manual version updates** (if needed):
1. **Increment** the `@version` number in the script metadata
2. **Update** the corresponding version in README.md
3. **Commit** with `[skip-version]` in the commit message

## Common Script Patterns

### DOM Observation for Dynamic Content

Many scripts use `MutationObserver` to handle dynamic page updates:

```javascript
new MutationObserver(callback).observe(targetElement, {
  childList: true,
  subtree: true
});
```

**Example**: `Jira Age Dynamic Highlighter.user.js` uses debounced observation to re-highlight rows when the issue table changes.

### Self-Contained IIFEs

All scripts wrap code in immediately-invoked function expressions to avoid global scope pollution:

```javascript
(function() {
  'use strict';
  // Script code here
})();
```

### Accessing FireMonkey APIs

When using FireMonkey APIs, declare them in `@grant`:
- `GM.getValue` / `GM.setValue` - Persistent storage
- `GM_registerMenuCommand` - Add menu items to FireMonkey
- `none` - No special permissions needed

## Repository-Specific Guidelines

### When Creating New Scripts

1. **Use descriptive names**: The filename becomes part of the update URL
2. **Include complete metadata**: Especially `@match`, `@version`, and update URLs
3. **Add to README.md table**: Update the Scripts or Styles table with name, description, target site, and version
4. **Follow existing patterns**: Look at similar scripts for structural guidance

### When Modifying Existing Scripts

1. **Always increment `@version`**: This triggers FireMonkey auto-updates
2. **Preserve metadata format**: Don't change the structure of the metadata block
3. **Test on target sites**: Verify `@match` patterns still work
4. **Update README.md**: If description or version changes

### Filename Conventions

- User scripts: `Descriptive Name.user.js`
- User styles: `Descriptive Name.user.css`
- Use title case with spaces (they become `%20` in URLs)

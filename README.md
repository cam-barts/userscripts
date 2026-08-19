# FireMonkey User Scripts & Styles

My personal collection of user scripts and styles for [FireMonkey](https://github.com/erosman/firemonkey), the Firefox extension that manages both userscripts (Tampermonkey territory) and user styles (Stylus territory) in one place. Needs Firefox 93+ on desktop, 113+ on Android.

```
UserScripts/
├── scripts/          # User scripts (.user.js)
└── styles/           # User styles (.user.css)
```

## FireMonkey Hub

Most scripts here register with the FireMonkey Hub, a floating widget that gathers script actions, feature toggles, and update notifications into one panel instead of a pile of per-script buttons.

Install order matters, because consumers `@require` the client:

1. FireMonkey Hub - UI, storage, GitHub update checks
2. FireMonkey Hub Client - the shared protocol library every consumer script pulls in
3. Everything else

Five tabs: Actions groups registered commands by script, Features toggles things globally or per-site, Updates compares installed versions against this repo (one click to update), Discover lists repo files you haven't installed, and Settings has the repo URL, branch, and a reset button.

Scripts without their own UI (the Jira and Readwise ones, the Confluence extensions) still show up in Updates because the client declares them to the Hub.

## Installing

Get FireMonkey from [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/firemonkey/) (or the [beta from GitHub](https://github.com/erosman/firemonkey)). Then any of these works:

- Drag a `.user.js` or `.user.css` file into Firefox
- Import it from FireMonkey's options page
- Click a raw file link and let FireMonkey intercept it

## Auto-updates

Every file's `@updateURL` and `@downloadURL` point at this repo's raw GitHub URLs, so FireMonkey picks up new versions on its own schedule. The only rule: `@version` must go up on every change. A GitHub Action bumps it automatically on push to `main` and keeps the version columns below in sync (commit with `[skip-version]` if you bumped by hand).

Raw URLs look like this, with spaces encoded as `%20`:

```
https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/your-script.user.js
https://raw.githubusercontent.com/cam-barts/userscripts/main/styles/your-style.user.css
```

## Scripts

| Script Name | Description | Applies To | Version |
|------------|-------------|------------|---------|
| [FireMonkey Hub](scripts/FireMonkey%20Hub.user.js) | Floating widget for script actions, feature toggles, update notifications, and repo discovery (install first) | All sites | 0.9 |
| [FireMonkey Hub Client](scripts/FireMonkey%20Hub%20Client.user.js) | Shared hub-protocol library, `@require`'d by every consumer script | All sites | 0.1 |
| [Readwise Auto-Tag Loop (Simple Reload)](scripts/Readwise%20Auto-Tag%20Loop%20(Simple%20Reload).user.js) | Invoke Ghostreader & apply "ta" tag, then reload queue page until empty | Readwise | 0.6 |
| [Jira: show customfield IDs on hover](scripts/Jira%20show%20customfield%20IDs%20on%20hover.user.js) | Hover a field label on a Jira issue to see its customfield_xxx ID | Jira (Atlassian) | 0.6 |
| [GitHub Commit Labels](scripts/GitHub%20Commit%20Labels.user.js) | Colored labels on GitHub commit lists for conventional commit types (feat, fix, docs, etc.) | GitHub | 1.6.7 |
| [Confluence Menu Base](scripts/Confluence%20Menu%20Base.user.js) | Command menu for Confluence pages (required by the other Confluence scripts) | Confluence | 0.10 |
| [Confluence Menu: Reading Score](scripts/Confluence%20Menu%20Reading%20Score.user.js) | Readability scores (ARI, Coleman-Liau, Flesch, SMOG) with Hemingway-style highlighting of hard sentences | Confluence | 0.8 |
| [Confluence Menu: Add Count Words](scripts/Confluence%20Menu%20Add%20Count%20Words.user.js) | Count words on Confluence pages | Confluence | 0.7 |
| [Jira: Issue-Age Dynamic Highlighter](scripts/Jira%20Age%20Dynamic%20Highlighter.user.js) | Color-code Jira issue rows from green (new) to red (old) by table's oldest issue age | Jira (Atlassian) | 0.6 |
| [AI Writing Detector](scripts/AI%20Writing%20Detector.user.js) | Highlights signs of AI-generated writing (vocabulary, style, chatbot artifacts) based on Wikipedia's Signs of AI writing | All sites | 0.8 |
| [Table to CSV](scripts/Table%20to%20CSV.user.js) | Detect tables on any page, select one, and download it as a CSV file | All sites | 0.7 |

## Styles

| Style Name | Description | Applies To | Version |
|-----------|-------------|------------|---------|
| [BunkerWeb DarkPatterns Blocks](styles/BunkerWeb%20DarkPatterns%20Blocks.user.css) | Remove dark pattern UI elements (banners, buy now buttons, newsletter signups, pro menu items) | BunkerWeb | 1.0 |
| [Windmill GitHub Dark Theme](styles/Windmill%20GitHub%20Dark%20Theme.user.css) | GitHub Dark theme for Windmill | Windmill | 1.1 |

## Development

Scripts need a metadata block up top. For auto-updates, include `@updateURL` and `@downloadURL` with the actual filename, `%20`-encoded:

```javascript
// ==UserScript==
// @name        My Script Name
// @description What this script does
// @version     1.0
// @author      Your Name
// @match       https://example.com/*
// @grant       GM.getValue
// @run-at      document-end
// @updateURL   https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/my-script.user.js
// @downloadURL https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/my-script.user.js
// ==/UserScript==
```

Styles use the same idea in a CSS comment:

```css
/* ==UserStyle==
@name        My Style Name
@description What this style does
@version     1.0
@author      Your Name
@match       https://example.com/*
@updateURL   https://raw.githubusercontent.com/cam-barts/userscripts/main/styles/my-style.user.css
@downloadURL https://raw.githubusercontent.com/cam-barts/userscripts/main/styles/my-style.user.css
==/UserStyle== */
```

Dev tooling is npm-based but nothing from it ships: the committed files are exactly what FireMonkey installs. After `npm install`:

- `npm run lint` - metadata-block validation via eslint-plugin-userscripts
- `npm run test` - unit tests plus `@match` pattern validation for every script and style
- `npm run test:e2e` - Playwright tests for the Hub protocol; run these before pushing hub or consumer changes

## Contributing

This is a personal collection, but fork and adapt whatever you like.

## License

MIT. See [LICENSE](LICENSE). Individual scripts may carry their own license; check the file headers.

## Resources

- [FireMonkey repo](https://github.com/erosman/firemonkey) and [docs](https://github.com/erosman/firemonkey/wiki)
- [GreasyFork](https://greasyfork.org/) for more user scripts
- [UserStyles.world](https://userstyles.world/) for more user styles

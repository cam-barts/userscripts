# FireMonkey User Scripts & Styles

My personal collection of user scripts and styles for [FireMonkey](https://github.com/erosman/firemonkey), the Firefox extension that manages both userscripts (Tampermonkey territory) and user styles (Stylus territory) in one place. Needs Firefox 93+ on desktop, 113+ on Android.

```
UserScripts/
├── scripts/          # User scripts (.user.js)
└── styles/           # User styles (.user.css)
```

Every script stands alone. Anything you trigger by hand (AI highlighting, CSV export, the Confluence tools) is a command in the FireMonkey toolbar popup; nothing sits on the page until you invoke it.

## Migrating from the FireMonkey Hub

The Hub is gone. In FireMonkey, uninstall FireMonkey Hub, FireMonkey Hub Client, Confluence Menu Base, Confluence Menu: Reading Score, Confluence Menu: Add Count Words, and Readwise Auto-Tag Loop, then install [Confluence Tools](scripts/Confluence%20Tools.user.js).

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
| [Jira: show customfield IDs on hover](scripts/Jira%20show%20customfield%20IDs%20on%20hover.user.js) | Hover a field label on a Jira issue to see its customfield_xxx ID | Jira (Atlassian) | 0.7 |
| [GitHub Commit Labels](scripts/GitHub%20Commit%20Labels.user.js) | Colored labels on GitHub commit lists for conventional commit types (feat, fix, docs, etc.) | GitHub | 1.6.8 |
| [Confluence Tools](scripts/Confluence%20Tools.user.js) | Menu commands for word count, readability scores (ARI, Coleman-Liau, Flesch, SMOG), and Hemingway-style highlighting of hard sentences | Confluence | 1.1 |
| [Jira: Issue-Age Dynamic Highlighter](scripts/Jira%20Age%20Dynamic%20Highlighter.user.js) | Color-code Jira issue rows from green (new) to red (old) by table's oldest issue age | Jira (Atlassian) | 0.7 |
| [AI Writing Detector](scripts/AI%20Writing%20Detector.user.js) | Menu command that highlights signs of AI-generated writing (vocabulary, style, chatbot artifacts) based on Wikipedia's Signs of AI writing | All sites | 0.9 |
| [Table to CSV](scripts/Table%20to%20CSV.user.js) | Menu command that downloads a table on the page as CSV (pick one if there are several) | All sites | 0.8 |

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

## Contributing

This is a personal collection, but fork and adapt whatever you like.

## License

MIT. See [LICENSE](LICENSE). Individual scripts may carry their own license; check the file headers.

## Resources

- [FireMonkey repo](https://github.com/erosman/firemonkey) and [docs](https://github.com/erosman/firemonkey/wiki)
- [GreasyFork](https://greasyfork.org/) for more user scripts
- [UserStyles.world](https://userstyles.world/) for more user styles

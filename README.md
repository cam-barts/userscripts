# FireMonkey User Scripts & Styles

A personal collection of user scripts and user styles for [FireMonkey](https://github.com/erosman/firemonkey), a powerful Firefox extension that combines script and style management into one unified tool.

## About FireMonkey

FireMonkey is a modern browser extension for Firefox that serves as both a user-script manager (like Greasemonkey/Tampermonkey) and a user-style manager (like Stylus). It allows you to:

- **Run custom JavaScript** on websites with full GM API support
- **Apply custom CSS styling** to personalize web page appearances
- **Manage everything in one place** with an intuitive interface
- **Auto-update scripts** with built-in version checking
- **Import/Export** for easy backup and sharing

### Requirements

- Firefox 93+ (Desktop)
- Firefox 113+ (Android)

## Repository Structure

```
UserScripts/
├── scripts/          # User scripts (.user.js)
│   └── ...
└── styles/           # User styles (.user.css)
    └── ...
```

## Installation

### Installing FireMonkey

1. Install FireMonkey from [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/firemonkey/)
2. Or download the [latest beta](https://github.com/erosman/firemonkey) from GitHub

### Installing Scripts & Styles

**Method 1: Drag & Drop**
- Download the `.user.js` or `.user.css` file
- Drag and drop it into Firefox
- FireMonkey will prompt you to install

**Method 2: Manual Import**
1. Open FireMonkey options page
2. Navigate to the Import/Export section
3. Import the script or style file

**Method 3: Direct Installation**
- Click on any `.user.js` or `.user.css` file link
- FireMonkey will intercept and offer to install

## Auto-Updates

This repository is designed to serve as an auto-update source for FireMonkey scripts and styles. When you include the proper metadata in your scripts, FireMonkey will automatically check for and install updates.

### How It Works

1. **Host your repository on GitHub** (or any git hosting service)
2. **Add update URLs** to your script/style metadata pointing to the raw file URLs
3. **Update the version number** when you make changes
4. **FireMonkey checks for updates** based on your configured schedule

### Getting Raw URLs

For this repository, raw file URLs follow this format:
```
https://raw.githubusercontent.com/cam-barts/userscripts/main/scripts/your-script.user.js
https://raw.githubusercontent.com/cam-barts/userscripts/main/styles/your-style.user.css
```

Replace `your-script` or `your-style` with the actual filename.

### Important Notes

- Always increment the `@version` number when updating scripts/styles
- FireMonkey compares version numbers to determine if an update is available
- The `@updateURL` is checked for version info (metadata only)
- The `@downloadURL` is used to download the full updated script/style
- For simplicity, both URLs can point to the same file

## Scripts

| Script Name | Description | Applies To | Version |
|------------|-------------|------------|---------|
| [Readwise Auto-Tag Loop (Simple Reload)](scripts/Readwise%20Auto-Tag%20Loop%20(Simple%20Reload).user.js) | Invoke Ghostreader & apply "ta" tag, then reload queue page until empty | Readwise | 0.1 |
| [Jira: show customfield IDs on hover](scripts/Jira%20show%20customfield%20IDs%20on%20hover.user.js) | Hover a field label on a Jira issue to see its customfield_xxx ID | Jira (Atlassian) | 0.1 |
| [GitHub Commit Labels](scripts/GitHub%20Commit%20Labels.user.js) | Enhances GitHub commits with beautiful labels for conventional commit types (feat, fix, docs, etc.) | GitHub | 1.6.2 |
| [Confluence Menu Base](scripts/Confluence%20Menu%20Base.user.js) | Add command menu to Confluence pages (required for other Confluence scripts) | Confluence | 0.4 |
| [Confluence Menu: Reading Score](scripts/Confluence%20Menu%20Reading%20Score.user.js) | Analyzes page readability with multiple metrics (ARI, Coleman-Liau, Flesch, SMOG). Features hemingwayapp.com-inspired sentence highlighting to identify complex sentences with interactive tooltips showing detailed readability scores. | Confluence | 0.1 |
| [Confluence Menu: Add Count Words](scripts/Confluence%20Menu%20Add%20Count%20Words.user.js) | Count words on Confluence pages | Confluence | 0.2 |
| [Jira: Issue-Age Dynamic Highlighter](scripts/Jira%20Age%20Dynamic%20Highlighter.user.js) | Color-code Jira issue rows from green (new) to red (old) by table's oldest issue age | Jira (Atlassian) | 0.1 |
| [AI Writing Detector](scripts/AI%20Writing%20Detector.user.js) | Highlights signs of AI-generated writing (vocabulary, style, chatbot artifacts) based on Wikipedia's Signs of AI writing | All sites | 0.1 |

## Styles

| Style Name | Description | Applies To | Version |
|-----------|-------------|------------|---------|
| [BunkerWeb DarkPatterns Blocks](styles/BunkerWeb%20DarkPatterns%20Blocks.user.css) | Remove dark pattern UI elements (banners, buy now buttons, newsletter signups, pro menu items) | BunkerWeb | 1.0 |

## Development

### Creating New Scripts

User scripts should include standard metadata at the top. For auto-updates, include `@updateURL` and `@downloadURL`:

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

// Your code here
```

**Note:** Replace `my-script` with your actual script filename.

### Creating New Styles

User styles should include metadata in CSS comments. For auto-updates, include `@updateURL` and `@downloadURL`:

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

/* Your CSS here */
```

**Note:** Replace `my-style` with your actual style filename.

## Features

- **CodeMirror Editor**: Syntax highlighting and linting with JSHint
- **Flexible Execution**: Configure injection timing and context
- **Sub-frame Support**: Scripts can run in iframes with `@allFrames`
- **Storage Sync**: Sync across Firefox profiles (up to 100KB)
- **Auto-updates**: Built-in version checking and update system

## Contributing

This is a personal collection, but feel free to fork and adapt any scripts or styles for your own use.

## License

This repository is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Individual scripts and styles may have their own licenses. Please check individual files for specific license information.

## Resources

- [FireMonkey GitHub Repository](https://github.com/erosman/firemonkey)
- [FireMonkey Documentation](https://github.com/erosman/firemonkey/wiki)
- [GreasyFork](https://greasyfork.org/) - Discover more user scripts
- [UserStyles.world](https://userstyles.world/) - Discover more user styles

---

**Powered by [FireMonkey](https://github.com/erosman/firemonkey)** - The unified user script and style manager for Firefox

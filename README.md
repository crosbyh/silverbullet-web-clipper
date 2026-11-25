# Web Clipper for SilverBullet

A fork of the [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper) that saves clips to a [SilverBullet](https://silverbullet.md) space instead of an Obsidian vault.

It keeps everything that makes the upstream clipper good: Defuddle article extraction, templates, variables and filters, the highlighter, reader view, and the AI interpreter. Only the last step changes. Instead of handing the note to the Obsidian app through an `obsidian://` link, the extension writes the page to SilverBullet's [HTTP API](https://docs.silverbullet.md/Integrations/HTTP%20API) (`/.fs`). Because the save is a real HTTP request, the popup reports failures (bad token, wrong URL, server unreachable) instead of failing silently, and clipping works on any device without a desktop app.

This is an unofficial fork and is not affiliated with Obsidian or SilverBullet.

## Set up

1. In SilverBullet's Dashboard, issue an **API token** for an account with write access to the space.
2. Build and load the extension (see [Install the extension locally](#install-the-extension-locally)).
3. Open the extension's settings. Under **SilverBullet spaces**, enter:
   - **Name:** any label. Templates and the popup's space picker refer to spaces by this name.
   - **Space URL:** the space's address as it appears in your browser. On a multi-space server, include the space's path, for example `https://sb.example.com/notes`.
   - **API token:** the token from step 1. If you leave it empty, the extension sends your browser's SilverBullet session cookie instead (untested; the token is the reliable option).
   - **Journal page prefix:** where daily notes go. Match the space's *Journal page prefix* setting (default `Journal/`).
4. Click **Add space**. The extension checks the URL and token before saving the space.

Spaces and tokens are stored in the browser's local extension storage. They do not sync between browsers and are not included in **Export all settings**.

## How templates map to SilverBullet

| Template behavior | What happens in SilverBullet |
|---|---|
| Create new note | Creates `<path>/<note name>`. If that page exists, the clip goes to `<note name> 1`, `<note name> 2`, and so on. Nothing is overwritten. |
| Overwrite note | Replaces the page. |
| Add to an existing note (append/prepend) | Appends after a blank line, or prepends below the page's frontmatter. Creates the page if it is missing. Concurrent edits are detected (`If-Match`) and the clip is retried rather than overwriting them. |
| Add to daily note (append/prepend) | Same as above, on `<journal prefix>YYYY-MM-DD`. A new journal page gets SilverBullet's journal frontmatter (`tags: journal`, `date`). |

Note names are cleaned to follow SilverBullet's [name rules](https://docs.silverbullet.md/Reference/Concepts/Names). Characters that reverse proxies such as Traefik reject in URLs (`? ; % \`) are removed too.

After a successful save, the page opens in a new tab unless **Save clipped note without opening it** is on.

### Template tips

The upstream templates work as they are: frontmatter, `[[wiki links]]`, `==highlights==` and footnotes are all SilverBullet Markdown. Obsidian-only syntax in your own templates, such as callouts or `![[embeds]]` of Obsidian files, may render differently. Images stay as links to the original site, as they do upstream.

For the template syntax, variables and filters, see the upstream [Web Clipper documentation](https://help.obsidian.md/web-clipper).

## Differences from upstream

- `src/utils/silverbullet-api.ts`: the `/.fs` client and save logic (unit tested in `silverbullet-api.test.ts`).
- `src/utils/silverbullet-spaces.ts` and `src/utils/silverbullet-note-creator.ts`: space storage and the replacement for `saveToObsidian`.
- The general settings "Vaults" list became a SilverBullet space manager. Legacy mode is hidden.
- English strings, extension name, icons and logos are rebranded. Other languages still mention Obsidian in places.
- The Firefox add-on ID is `silverbullet-web-clipper@crosbyh.github.io`.
- The Safari/Xcode project and the CLI (`npm run build:cli`) are untouched and still target Obsidian.

The fork keeps its changes in a few files so upstream releases can be merged with few conflicts:

```
git fetch upstream
git merge upstream/main
```

## Developers

To build the extension:

```
npm run build
```

This will create three directories:
- `dist/` for the Chromium version
- `dist_firefox/` for the Firefox version
- `dist_safari/` for the Safari version

### Install the extension locally

For Chromium browsers, such as Chrome, Brave, Edge, and Arc:

1. Open your browser and navigate to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist` directory

For Firefox:

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Navigate to the `dist_firefox` directory and select the `manifest.json` file

If you want to run the extension permanently you can do so with the Nightly or Developer versions of Firefox.

1. Type `about:config` in the URL bar
2. In the Search box type `xpinstall.signatures.required`
3. Double-click the preference, or right-click and select "Toggle", to set it to `false`.
4. Go to `about:addons` > gear icon > **Install Add-on From File…**

For iOS Simulator testing on macOS:

1. Run `npm run build` to build the extension
2. Open `xcode/Obsidian Web Clipper/Obsidian Web Clipper.xcodeproj` in Xcode
3. Select the **Obsidian Web Clipper (iOS)** scheme from the scheme selector
4. Choose an iOS Simulator device and click **Run** to build and launch the app
5. Once the app is running on the simulator, open **Safari**
6. Navigate to a webpage and tap the **Extensions** button in Safari to access the Web Clipper extension

### Run tests

```
npm test
```

Or run in watch mode during development:

```
npm run test:watch
```

### Live test against a SilverBullet space

`src/utils/silverbullet-api.live.test.ts` runs the save logic against a real space. It writes under `Inbox/Clipper live test <timestamp>/` and deletes the pages afterwards. It is skipped unless both variables are set:

```
SB_LIVE_URL=https://sb.example.com/notes SB_LIVE_TOKEN=... npx vitest run silverbullet-api.live
```

## Third-party libraries

- [webextension-polyfill](https://github.com/mozilla/webextension-polyfill) for browser compatibility
- [defuddle](https://github.com/kepano/defuddle) for content extraction and Markdown conversion
- [dayjs](https://github.com/iamkun/dayjs) for date parsing and formatting
- [lz-string](https://github.com/pieroxy/lz-string) to compress templates to reduce storage space
- [lucide](https://github.com/lucide-icons/lucide) for icons
- [dompurify](https://github.com/cure53/DOMPurify) for sanitizing HTML

## License

The source code is MIT licensed, like the upstream project (see [LICENSE](LICENSE)). Obsidian's trademarks, icons and marketing assets are excluded from that license and are not used in this fork's Chrome and Firefox builds. The Safari/Xcode project still carries upstream's app icons.

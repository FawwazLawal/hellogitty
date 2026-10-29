# HelloGitty for Chrome

A Chrome extension that shows your GitHub pull requests and issues, sorted by whose move it is, with the count waiting on you in the toolbar badge.

It renders the same "Your work" board as the [HelloGitty](https://github.com/FawwazLawal/hellogitty) dashboard — Your move, Waiting on others, Finished — with the same one-sentence statuses. The classifier runs as WebAssembly compiled from HelloGitty's own `internal/work` package, so the two can never drift apart.

## Views

- **Popup** — click the toolbar icon for a quick glance. Search and a "Needs me" filter let you zero in on what matters.
- **Side panel** — pin the board beside any tab. Same compact layout as the popup, always one click away.
- **Full tab** — opens a full-width board. If a HelloGitty dashboard is running at `localhost:7340`, the tab redirects there instead.

## Install from the Chrome Web Store

1. Visit the [HelloGitty for Chrome](https://chromewebstore.google.com) listing *(link updated once published)*
2. Click **Add to Chrome**
3. Sign in with a GitHub token or OAuth when prompted

## Install from source (unpacked)

1. Clone this repository
2. Build the extension (see below)
3. Go to `chrome://extensions`, turn on **Developer mode**
4. Click **Load unpacked** and pick the `dist/hellogitty` folder

## Build

### Prerequisites

- **Go 1.22+** (for the WebAssembly build)
- A local checkout of [hellogitty](https://github.com/FawwazLawal/hellogitty) — the build compiles `wasm/main.go` inside it and extracts the dashboard's CSS and JS from `web/index.html`

### Commands

```bash
# If hellogitty-clone is a sibling directory (the default):
./build.sh

# Otherwise, point to your checkout:
HELLOGITTY_ROOT=/path/to/hellogitty-clone ./build.sh

# Bake in the OAuth app's public client ID for device-flow sign-in:
HELLOGITTY_CLIENT_ID=Ov23li... ./build.sh
```

The build produces `dist/hellogitty/` (the unpacked extension) and `dist/hellogitty-extension-<version>.zip` (for the Chrome Web Store). Builds are deterministic: fixed timestamps and a sorted file list make the zip byte-identical across runs.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Chrome MV3 manifest |
| `background.js` | Service worker: alarms, sign-in, fetch, classify, badge |
| `board.html` | Popup, side panel and full view |
| `board.js` | Renders the dashboard's markup from the stored board |
| `extension.css` | Rules the dashboard stylesheet doesn't cover |
| `config.js` | OAuth client ID and scope (empty by default) |
| `wasm/main.go` | WebAssembly entry point (compiles `internal/work`) |
| `icons/` | Extension icons (16, 32, 48, 128 px) |
| `build.sh` | Builds `dist/` from this repo and a hellogitty checkout |

## Privacy

HelloGitty contacts only GitHub's API (`api.github.com`): GraphQL to fetch your pull requests and issues, and the notifications endpoint to mark the ones with unread activity as New (read-only; it never marks anything read). All data is stored locally in Chrome's extension storage. There is no analytics, telemetry, or tracking of any kind. Your GitHub token is sent only to GitHub.

See [store/privacy.txt](store/privacy.txt) for the full privacy policy.

## License

See the [HelloGitty license](https://github.com/FawwazLawal/hellogitty/blob/main/LICENSE).

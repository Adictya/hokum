# hokum.app

The website for Hokum: one URL, generated from the repository so it can't drift from the docs.

`https://hokum.app/` is the only page. Browsers get HTML; agents and command line tools get the
same page as one self-contained markdown document: install, usage, the configuration reference,
the complete theme guide (`docs/themes.md`) and the source of every built-in theme, with links
between them rewritten to headings. Hokum's **Make your own theme** prompt points agents here.

| Source | Becomes |
|---|---|
| `README.md` | The intro, install tabs, usage and features (the bold bullets under `## Use`) |
| `docs/theming.md` | Configure, with the full reference folded under it |
| `docs/themes.md` | Make your own theme, with the full guide folded under it |
| `themes/*.kdl` | The theme gallery (name and leading comment); inlined in the markdown |
| `Cargo.toml` | The version in the masthead |
| `site/screenshots/` | Theme screenshots, rendered by Hokum itself (below) |

## Who gets markdown

`worker.ts` decides per request to `/` (and sends `Vary: Accept, User-Agent`):

- `?format=md` or `?format=html` wins.
- Markdown when `Accept` rates `text/markdown` at least as high as `text/html` (so curl's `*/*`
  gets markdown), or `text/plain` higher than it, or doesn't mention `text/html` at all.
- Markdown for user agents that aren't browsers: HTTP libraries and CLIs (curl, wget,
  python-requests, node-fetch, undici, Go-http-client, …), AI fetchers and crawlers (Claude,
  GPTBot, ChatGPT-User, OAI-SearchBot, PerplexityBot, …), coding agents (opencode, …), headless
  browsers, and anything without `Mozilla` in it.
- Otherwise (a browser: `text/html` in `Accept` and a Mozilla user agent) HTML.

Every other path except assets (`/style.css`, `/favicon.svg`, `/assets/*`, `/screenshots/*`)
redirects to `/`, including the old `/themes.md`, `/theming.md`, `/index.md`, `/llms.txt` and
`/themes/*.kdl`. `www.hokum.app` redirects to the apex.

## Build

```sh
cd site
bun install
bun run build                       # writes site/dist (index.html, page.md, assets)
bunx wrangler dev                   # serves dist through the Worker, as in production
curl -s localhost:8787 | head       # markdown
open 'http://localhost:8787/?format=html'
```

`build.ts` is the whole generator: `marked` for the markdown, a template string for the page,
`style.css` for the look (one column, Inter for prose and IBM Plex Mono for anything typed, after
opentunnel.xyz). No JavaScript is loaded from elsewhere; the inline script only adds copy buttons
and opens a folded reference when a link points into it. Fonts are self-hosted from `assets/`.

## Screenshots

```sh
site/scripts/screenshots.sh
```

Rendering needs a GPU, so this pushes the current commit to a throwaway clone on `apollo`
(`HOKUM_GPU_HOST` to change it), builds a release binary there in `/tmp/hokum-site-target`, and
for each built-in theme runs `hokum service --snap … --scene demo` in dark and light with a
throwaway `XDG_CONFIG_HOME` whose `config.kdl` is `theme "<id>"`. The PNGs come back, are given a
common frame (960×1260) and saved as WebP in `site/screenshots/`. The host's installed Hokum and
`~/.config/hokum` aren't touched; `CLEAN=1` also removes the target dir. Rerun it when a theme or
the card rendering changes, and commit the result.

## Deploy

```sh
cd site
bun run deploy         # build, then wrangler deploy
```

The Worker `hokum-site` on the Anomaly account (`wrangler.jsonc`) serves `dist/` and owns the
custom domains `hokum.app` and `www.hokum.app`. workers.dev and preview URLs are off. Pushes that
only touch `site/` don't trigger a Hokum release.

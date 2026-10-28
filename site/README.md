# hokum.app

The website for Hokum: one URL, generated from the repository so it can't drift from the docs.

`https://hokum.app/` is the only page. Browsers get HTML; agents and command line tools get the
same page as one self-contained markdown document: install, usage, the configuration reference,
the complete theme guide (`docs/themes.md`) and the source of every built-in theme, with links
between them rewritten to headings. Hokum's **Make your own theme** prompt points agents here.

The page has no images. It opens on a desktop where a crime story plays out entirely in
notification cards, in Capsule, stacking in the top-right corner: a $40 pizza dispute, a lake, a
lot of lime, and every escalation after it. The install command sits on that desktop from the
start.

| Source | Becomes |
|---|---|
| `README.md` | The install section, usage and features (the bold bullets under `## Use`) |
| `docs/theming.md` | Configure, with the full reference folded under it |
| `docs/themes.md` | Make your own theme, with the full guide folded under it |
| `themes/*.kdl` | The theme list (name and leading comment) and the markdown |
| `story.js` | The story: every card as data (`at` seconds, story `time`, app, title, body, actions) |
| `hero.js` | The cards: Capsule's look and spring, stacking, the "N more" pill, drag, fling, dismiss, the desktop clock, skip and replay |

The prototype it came from lives at https://anoma.ly/labs/hokum-story (branch `hero-story`,
`site-prototypes/story/`); keep `story.js` the same in both. `?t=60` starts the story 60 s in.
The story pauses while the hero is scrolled off screen, and `prefers-reduced-motion` keeps the
same script without the movement.

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

Every other path except assets (`/style.css`, `/favicon.svg`, `/story.js`, `/hero.js`, `/site.js`, `/assets/*`) redirects
to `/`, including the old `/themes.md`, `/theming.md`, `/index.md`, `/llms.txt` and
`/themes/*.kdl`. `www.hokum.app` redirects to the apex.

## Build

```sh
cd site
bun install
bun run build                        # writes dist/ (index.html, page.md, assets)
bunx wrangler dev                    # serves dist through the Worker, as in production
curl -s localhost:8787 | head        # markdown
open 'http://localhost:8787/?format=html'
```

`build.ts` is the whole generator: `marked` for the markdown, a template string for the page,
`style.css` for the look. No JavaScript is loaded from elsewhere and the CSP allows only this
origin. Fonts (Inter, IBM Plex Mono) are self-hosted from `assets/`.

## Deploy

```sh
cd site
bun run deploy         # build, then wrangler deploy
```

The Worker `hokum-site` on the Anomaly account (`wrangler.jsonc`) serves `dist/` and owns the
custom domains `hokum.app` and `www.hokum.app`. workers.dev and preview URLs are off. Pushes that
only touch `site/` don't trigger a Hokum release.

# hokum.app

The website for Hokum: one URL, generated from the repository so it can't drift from the docs.

`https://hokum.app/` is the only page. Browsers get HTML; agents and command line tools get the
same page as one self-contained markdown document: install, usage, the configuration reference,
the complete theme guide (`docs/themes.md`) and the source of every built-in theme, with links
between them rewritten to headings. Hokum's **Make your own theme** prompt points agents here.

The HTML page is one screen and a footer, with no images: black, the product switcher (the
`products` list in `build.ts`) and GitHub on top, then two columns on one container. Left, the
headline and the install row (`site.js` guesses the platform; `?platform=arch|debian|fedora|binary`,
`?cpu=arm64`); right, a fixed-height column where the story's cards play under a clock line. Everything else (install
details, usage, configuration, the theme guide and every built-in theme) is only in the markdown
agents get.

| Source | Becomes |
|---|---|
| `README.md` | The install commands; install, usage and features in the markdown |
| `docs/theming.md` | The configuration reference (markdown) |
| `docs/themes.md` | The theme guide (markdown) |
| `themes/*.kdl` | The built-in theme sources (markdown) |
| `story.js` | The story as data: `STORY_TRUNK` (everyone sees it), then `STORY_BRANCHES` (six endings) |
| `hero.js` | The cards: Capsule's look and spring, stacking, the "N more" pill, drag, fling, dismiss, the clock, and Replay once the story ends |

Each visit plays the trunk and one random branch; Replay picks one not seen yet. `?branch=1..6`
or `?branch=gig|agent|world|legend|dead|empire` forces one, `?t=60` starts 60 s in. The
prototype at https://anoma.ly/labs/hokum-story (branch `hero-story`) runs the same `story.js`
and `hero.js` logic; keep them in sync. The story pauses while scrolled off screen, and
`prefers-reduced-motion` keeps the script without the movement.

## The settings window picture

The page's one image, `assets/settings.webp` (2x) and `assets/settings-1x.webp`, is Hokum's
settings window rendered by the real app. Regenerate it after the window changes:

```sh
site/scripts/settings-shot.sh            # builds origin/dev on apollo (HOKUM_GPU_HOST), snapshots, converts
```

It builds a throwaway clone with its own target dir and runs `hokum --snap … --scene hokum
--scale 2 --theme dark` with a throwaway HOME and config (Capsule), then cleans up the host.

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

`build.ts` is the whole generator: string templates for the markdown and the page,
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

# hokum.app

The website for Hokum: one URL, generated from the repository so it can't drift from the docs.

`https://hokum.app/` is the only page. Browsers get HTML; agents and command line tools get the
same page as one self-contained markdown document: install, usage, the configuration reference,
the complete theme guide (`docs/themes.md`) and the source of every built-in theme, with links
between them rewritten to headings. Hokum's **Make your own theme** prompt points agents here.

The page has no images. From the top: the Anomaly product switcher (the `products` list in `build.ts`) and GitHub; the hero, a
desktop where a crime story plays out in notification cards; the headline and an install button
for the visitor's platform (`site.js` guesses; `?platform=arch|debian|fedora|binary`); four
live feature clips (`clips.js`, drawn with the hero's cards); what Hokum does, the "make your own
theme" prompt and the folded references; the Anomaly footer with a "Built with opencode" badge.

| Source | Becomes |
|---|---|
| `README.md` | Install, usage and features (the bold bullets under `## Use`) |
| `docs/theming.md` | The configuration reference |
| `docs/themes.md` | The theme guide |
| `themes/*.kdl` | The built-in themes list and the markdown |
| `story.js` | The story as data: `STORY_TRUNK` (everyone sees it), then `STORY_BRANCHES` (six endings) |
| `hero.js` | The cards: Capsule's look and spring, stacking, the "N more" pill, drag, fling, dismiss, the desktop clock, skip and replay |

Each visit plays the trunk and one random branch; Replay picks one not seen yet. `?branch=1..6`
or `?branch=gig|agent|world|legend|dead|empire` forces one, `?t=60` starts 60 s in. The
prototype at https://anoma.ly/labs/hokum-story (branch `hero-story`) runs the same `story.js`
and `hero.js` logic; keep them in sync. The story pauses while scrolled off screen, and
`prefers-reduced-motion` keeps the script without the movement.

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

Every other path except assets (`/style.css`, `/favicon.svg`, `/story.js`, `/hero.js`, `/clips.js`, `/site.js`, `/assets/*`) redirects
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

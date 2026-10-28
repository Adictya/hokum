# hokum.app

The website for Hokum: one page, generated from the repository so it can't drift from the docs.

| Source | Becomes |
|---|---|
| `README.md` | The intro, features (the bold bullets under `## Use`), install, usage, and `/index.md` |
| `docs/theming.md` | The Configuration section, and `/theming.md` verbatim |
| `docs/themes.md` | The Make your own theme section, and `/themes.md` verbatim (the app's prompt points agents here) |
| `themes/*.kdl` | The theme gallery (name and leading comment) and `/themes/<id>.kdl` |
| `Cargo.toml` | The version shown in the hero and footer |
| `site/screenshots/` | Theme screenshots, rendered by Hokum itself (below) |

`/llms.txt` is an index for agents ([llmstxt.org](https://llmstxt.org)). Links between the docs
resolve on the site: `themes.md`, `theming.md#scripts` and `../themes/terminal.kdl` work from the
raw markdown, and become section anchors on the page.

## Build

```sh
cd site
bun install
bun run build          # writes site/dist
bunx wrangler dev      # serves dist through the Worker, as in production
```

`build.ts` is the whole generator: `marked` for the markdown, a template string for the page,
`style.css` for the look. No JavaScript is loaded from elsewhere, and the only script on the page
adds copy buttons. Inter is self-hosted from `assets/`.

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

The Worker `hokum-site` on the Anomaly account serves `dist/` as static assets
(`wrangler.jsonc`). It owns the custom domains `hokum.app` and `www.hokum.app`; `worker.ts`
redirects `www` to the apex and gives `.md` files `text/markdown; charset=utf-8` and `.txt` /
`.kdl` files `text/plain; charset=utf-8`. `_headers` adds the security headers and caching.
workers.dev and preview URLs are off. Deploys are by hand for now.

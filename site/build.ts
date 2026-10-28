// Builds hokum.app into site/dist from the repository: README.md, docs/theming.md,
// docs/themes.md, themes/*.kdl and the rendered screenshots in site/screenshots.
import { Marked, type Tokens } from "marked"
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const site = import.meta.dir
const root = join(site, "..")
const dist = join(site, "dist")
const origin = "https://hokum.app"
const repo = "https://github.com/anomalyco/hokum"
const release = "https://anoma.ly/release/hokum/desktop/stable"
const prompt =
  "Read https://hokum.app/themes.md and create a Hokum theme for me, then switch my config to it. I want it to look like: "

const read = (path: string) => readFileSync(join(root, path), "utf8")
const readme = read("README.md")
const themesDoc = read("docs/themes.md")
const themingDoc = read("docs/theming.md")
const version = read("Cargo.toml").match(/^version = "(.+)"/m)?.[1] ?? ""

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")

// README sections by `## ` heading, plus the text before the first one.
function sections(md: string) {
  const parts = md.split(/^## /m)
  const out: Record<string, string> = { "": parts[0] }
  for (const part of parts.slice(1)) {
    const nl = part.indexOf("\n")
    out[part.slice(0, nl).trim()] = part.slice(nl + 1).trim()
  }
  return out
}

// Links in the repo's markdown point at files in the repo; on the page they point at the
// matching section, a file served next to the page, or GitHub.
function rewrite(href: string, prefix: string) {
  if (href.startsWith("#")) return `#${prefix}-${href.slice(1)}`
  if (/^[a-z]+:/i.test(href)) return href
  const [path, hash] = href.split("#")
  const name = path.split("/").pop()
  if (name === "themes.md") return hash ? `#guide-${hash}` : "#theme-guide"
  if (name === "theming.md") return hash ? `#config-${hash}` : "#configuration"
  const kdl = path.match(/themes\/([\w-]+\.kdl)$/)
  if (kdl) return `/themes/${kdl[1]}`
  const clean = path.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "")
  const kind = clean.includes(".") ? "blob" : "tree"
  return `${repo}/${kind}/dev/${clean}${hash ? `#${hash}` : ""}`
}

// A renderer for one document: its h1 is dropped (the page supplies the section heading),
// other headings move down a level and get ids under `prefix`.
function markdown(prefix: string) {
  return new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        if (depth === 1) return ""
        const html = this.parser.parseInline(tokens)
        const id = `${prefix}-${slug(html)}`
        const level = Math.min(depth + 1, 6)
        return `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${html}</h${level}>\n`
      },
      link({ href, title, tokens }: Tokens.Link) {
        const url = rewrite(href, prefix)
        const external = /^https?:/.test(url) && !url.startsWith(origin)
        return `<a href="${escape(url)}"${title ? ` title="${escape(title)}"` : ""}${external ? ' rel="noopener"' : ""}>${this.parser.parseInline(tokens)}</a>`
      },
      code({ text, lang }: Tokens.Code) {
        return `<pre class="code"${lang ? ` data-lang="${escape(lang)}"` : ""}><code>${escape(text)}</code></pre>\n`
      },
      table(token: Tokens.Table) {
        const cell = (c: Tokens.TableCell, tag: string) => `<${tag}>${this.parser.parseInline(c.tokens)}</${tag}>`
        const head = token.header.map((c) => cell(c, "th")).join("")
        const body = token.rows.map((r) => `<tr>${r.map((c) => cell(c, "td")).join("")}</tr>`).join("\n")
        return `<div class="table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>\n`
      },
    },
  })
}

const render = (md: string, prefix: string) => markdown(prefix).parse(md) as string
const inline = (md: string, prefix: string) => markdown(prefix).parseInline(md) as string

const readmeParts = sections(readme)
const intro = readmeParts[""].split("\n\n").slice(2).join("\n\n").trim()
const use = readmeParts["Use"]

// "- **Label:** text" bullets in README's Use section are the feature list.
const features = [...use.matchAll(/^- \*\*(.+?):\*\* ([\s\S]+?)(?=\n- |\n\n|(?![\s\S]))/gm)].map((m) => ({
  title: m[1],
  html: inline(m[2].replace(/\s*\n\s*/g, " ").replace(/^./, (c) => c.toUpperCase()), "use"),
}))
const usage = use.replace(/^- [\s\S]+?(?=\n\n[^-])/m, "").trim()

// Install: everything up to the paragraph about starting with the session; that part gets
// its own heading.
const installMd = readmeParts["Install"]
const serviceAt = installMd.indexOf("Hokum starts through D-Bus")
const install = serviceAt < 0 ? installMd : installMd.slice(0, serviceAt).trim()
const service = serviceAt < 0 ? "" : installMd.slice(serviceAt).trim()

// Built-in themes, in the order README lists them, the default first.
const themeFiles = readdirSync(join(root, "themes"))
  .filter((f) => f.endsWith(".kdl") && f !== "default.kdl")
  .map((f) => {
    const id = f.replace(/\.kdl$/, "")
    const src = read(`themes/${f}`)
    const name = src.match(/^name "(.+)"/m)?.[1] ?? id
    const comment = src
      .split("\n")
      .filter((l) => l.startsWith("//"))
      .map((l) => l.replace(/^\/\/\s?/, ""))
      .join(" ")
      .replace(/^\S+:\s*/, "")
      .replace(/\s*The default\.$/, "")
      .replace(/^./, (c) => c.toUpperCase())
    return { id, name, comment, file: f }
  })
const listed = readme.match(/built in \(([^)]+)\)/)?.[1].split(/,\s*/) ?? []
const defaultTheme = readme.match(/(\w+), with app icons, is the default/)?.[1] ?? "Capsule"
const order = (name: string) => (name === defaultTheme ? -1 : listed.indexOf(name) >>> 0)
const themes = themeFiles.sort((a, b) => order(a.name) - order(b.name))

const shots = join(site, "screenshots")
const shot = (id: string, mode: string) => existsSync(join(shots, `${id}-${mode}.webp`))
const size = (id: string) => {
  // WebP VP8/VP8L/VP8X headers carry the canvas size; read it so images reserve their space.
  const b = readFileSync(join(shots, `${id}-dark.webp`))
  const fourcc = b.toString("ascii", 12, 16)
  if (fourcc === "VP8X") return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)]
  if (fourcc === "VP8L") {
    const bits = b.readUInt32LE(21)
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1]
  }
  return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]
}

function picture(id: string, alt: string, eager = false) {
  if (!shot(id, "dark")) return `<div class="missing">${escape(alt)}</div>`
  const [w, h] = size(id)
  const light = shot(id, "light")
    ? `<source srcset="/screenshots/${id}-light.webp" media="(prefers-color-scheme: light)">`
    : ""
  return `<picture>${light}<img src="/screenshots/${id}-dark.webp" width="${w}" height="${h}" alt="${escape(alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async"></picture>`
}

const downloads = [
  ["x64", "x86_64"],
  ["arm64", "aarch64"],
]
  .map(
    ([arch, label]) => `<tr><th>${label}</th>
      <td><a href="${release}/linux-${arch}">executable</a></td>
      <td><a href="${release}/linux-${arch}-deb">.deb</a></td>
      <td><a href="${release}/linux-${arch}-rpm">.rpm</a></td></tr>`,
  )
  .join("\n")

const nav = [
  ["themes", "Themes"],
  ["features", "Features"],
  ["install", "Install"],
  ["usage", "Usage"],
  ["configuration", "Configuration"],
  ["theme-guide", "Make a theme"],
]

const description = readme.split("\n\n")[1].trim()
const icon = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="6" width="26" height="9" rx="4.5" fill="currentColor" opacity=".45"/><rect x="3" y="17" width="26" height="9" rx="4.5" fill="currentColor"/></svg>`
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#16171d"/><rect x="5" y="7" width="22" height="8" rx="4" fill="#8f9bff" opacity=".5"/><rect x="5" y="17" width="22" height="8" rx="4" fill="#8f9bff"/></svg>`

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hokum: notifications for Wayland</title>
<meta name="description" content="${escape(description)}">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#0f1014" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f5f5f7" media="(prefers-color-scheme: light)">
<meta property="og:title" content="Hokum">
<meta property="og:description" content="${escape(description)}">
<meta property="og:image" content="${origin}/screenshots/${themes[0].id}-dark.webp">
<meta property="og:url" content="${origin}/">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/inter.woff2" as="font" type="font/woff2" crossorigin>
<link rel="alternate" type="text/markdown" href="/index.md" title="This page as markdown">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="bar">
  <div class="wrap bar-inner">
    <a class="brand" href="#top">${icon}<span>Hokum</span></a>
    <nav aria-label="Sections">${nav.map(([id, label]) => `<a href="#${id}">${label}</a>`).join("")}</nav>
    <a class="gh" href="${repo}" rel="noopener" aria-label="GitHub"><svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg></a>
  </div>
</header>

<main id="top">
<section class="hero">
  <div class="wrap hero-inner">
    <div class="hero-copy">
      <p class="eyebrow">A notification daemon for Wayland${version ? ` · v${escape(version)}` : ""}</p>
      <h1>Notifications for Wayland that look like they belong on a computer from this decade.</h1>
      <div class="lede">${render(intro, "intro")}</div>
      <div class="cta">
        <a class="button primary" href="#install">Install</a>
        <a class="button" href="#theme-guide">Make your own theme</a>
        <a class="button ghost" href="${repo}" rel="noopener">GitHub</a>
      </div>
      <pre class="code one"><code>paru -S hokum-bin</code></pre>
    </div>
    <figure class="hero-shot desktop">${picture(themes[0].id, `${themes[0].name}, the default theme: a Slack message, a critical battery warning, a volume bar and a download`, true)}</figure>
  </div>
</section>

<section id="themes" class="wrap section">
  <h2><a class="anchor" href="#themes" aria-hidden="true">#</a>Themes</h2>
  <p class="sub">${themes.length} built in, each rendered here by Hokum itself from the same demo notifications. ${escape(defaultTheme)} is the default. Pick one in the settings window, or set <code>theme "&lt;id&gt;"</code> in <code>config.kdl</code>. The screenshots follow your system's light or dark appearance, as Hokum does.</p>
  <div class="gallery">
${themes
  .map(
    (t) => `    <figure class="theme" id="theme-${t.id}">
      <div class="desktop">${picture(t.id, `The ${t.name} theme`)}</div>
      <figcaption><span class="name">${escape(t.name)}</span>${t.name === defaultTheme ? '<span class="tag">default</span>' : ""}<code>theme "${t.id}"</code><a href="/themes/${t.file}">source</a><p>${escape(t.comment)}</p></figcaption>
    </figure>`,
  )
  .join("\n")}
  </div>
</section>

<section id="features" class="wrap section">
  <h2><a class="anchor" href="#features" aria-hidden="true">#</a>Features</h2>
  <div class="cards">
${features.map((f) => `    <article class="card"><h3>${escape(f.title)}</h3><p>${f.html}</p></article>`).join("\n")}
  </div>
</section>

<section id="install" class="wrap section prose">
  <h2><a class="anchor" href="#install" aria-hidden="true">#</a>Install</h2>
  ${render(install, "install")}
  <div class="table"><table class="downloads"><thead><tr><th>Stable</th><th>Executable</th><th>Debian / Ubuntu</th><th>Fedora / openSUSE</th></tr></thead><tbody>
${downloads}
  </tbody></table></div>
  <p>Every version, with checksums and release notes, is on <a href="${repo}/releases" rel="noopener">GitHub Releases</a>.</p>
  ${service ? `<h3 id="service"><a class="anchor" href="#service" aria-hidden="true">#</a>Start it with your session</h3>\n${render(service, "install")}` : ""}
</section>

<section id="usage" class="wrap section prose">
  <h2><a class="anchor" href="#usage" aria-hidden="true">#</a>Usage</h2>
  ${render(usage, "use")}
</section>

<section id="configuration" class="wrap section prose">
  <h2><a class="anchor" href="#configuration" aria-hidden="true">#</a>Configuration</h2>
  ${render(themingDoc, "config")}
</section>

<section id="theme-guide" class="wrap section prose">
  <h2><a class="anchor" href="#theme-guide" aria-hidden="true">#</a>Make your own theme</h2>
  <div class="agent card">
    <p>Custom themes are written by your coding agent. Copy this prompt into it, finish the sentence with the look you want, and it reads the guide below (also at <a href="/themes.md">hokum.app/themes.md</a>, as plain markdown), writes the theme, renders it headlessly to check its work, and switches your config to it.</p>
    <div class="prompt"><code id="prompt">${escape(prompt)}</code><button type="button" class="copy" data-copy="#prompt">Copy</button></div>
    <p class="hint">The same prompt is under <b>Make your own theme</b> in Hokum's settings window. The rest of this section is that guide, for agents and people alike.</p>
  </div>
  ${render(themesDoc, "guide")}
</section>
</main>

<footer class="foot">
  <div class="wrap foot-inner">
    <span>${icon} Hokum${version ? ` ${escape(version)}` : ""}</span>
    <nav>
      <a href="${repo}" rel="noopener">GitHub</a>
      <a href="${repo}/blob/dev/LICENSE" rel="noopener">MIT License</a>
      <a href="/llms.txt">llms.txt</a>
      <a href="https://anoma.ly" rel="noopener">Made by Anomaly</a>
    </nav>
  </div>
</footer>
<script>
for (const pre of document.querySelectorAll("pre.code")) {
  const b = document.createElement("button")
  b.type = "button"; b.className = "copy"; b.textContent = "Copy"
  b.addEventListener("click", () => copy(b, pre.innerText.replace(/\\n?Copy$/, "").trimEnd()))
  pre.append(b)
}
for (const b of document.querySelectorAll("button[data-copy]"))
  b.addEventListener("click", () => copy(b, document.querySelector(b.dataset.copy).textContent))
function copy(b, text) {
  navigator.clipboard.writeText(text).then(() => {
    b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1500)
  })
}
</script>
</body>
</html>
`

// Agent-facing files.
const absolute = (md: string) =>
  md.replace(/\]\(([^)]+)\)/g, (_, href: string) => {
    if (/^[a-z]+:|^#/i.test(href)) return `](${href})`
    const [path, hash] = href.split("#")
    const name = path.split("/").pop()!
    if (name.endsWith(".md") && (name === "themes.md" || name === "theming.md"))
      return `](${origin}/${name}${hash ? `#${hash}` : ""})`
    const kdl = path.match(/themes\/([\w-]+\.kdl)$/)
    if (kdl) return `](${origin}/themes/${kdl[1]})`
    return `](${rewrite(href, "")})`
  })

const more = `## More

- Configuration and theming: ${origin}/theming.md
- Writing a theme (for coding agents): ${origin}/themes.md
- Built-in themes: ${themes.map((t) => `${origin}/themes/${t.file}`).join(", ")}

`
const indexMd = absolute(readme)
  .replace(/^## Build[\s\S]*?(?=^## )/m, "")
  .replace(/^## License/m, `${more}## License`)

const llms = `# Hokum

> ${description.replace(/\s*\n\s*/g, " ")}

${intro.replace(/\s*\n\s*/g, " ").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")}

Install: \`paru -S hokum-bin\` on Arch; on Debian/Ubuntu download ${release}/linux-x64-deb (or linux-arm64-deb) and \`sudo apt install\` it; on Fedora/openSUSE ${release}/linux-x64-rpm (or linux-arm64-rpm) with \`sudo dnf install\`; or the bare executable from ${release}/linux-x64 (linux-arm64). Hokum starts by D-Bus activation; \`systemctl --user enable --now hokum.service\` starts it with the session instead.

Configuration is one file, \`~/.config/hokum/config.kdl\` (KDL v2): \`theme "<id>"\` picks a theme (built in: ${themes.map((t) => t.id).join(", ")}; default ${defaultTheme.toLowerCase()}), and \`tokens\`, \`template\`, \`rule\` and \`behaviour\` blocks override it. User themes live in \`~/.config/hokum/themes/<id>.kdl\`. Hokum reloads on save.

## Docs

- [Writing a Hokum theme](${origin}/themes.md): the complete theme format (tokens, colours, templates, rules) with two worked examples and how to render a theme headlessly to check it. Read this to make a theme for a user.
- [Configuring and theming Hokum](${origin}/theming.md): config.kdl, behaviour, rules and Rhai scripts.
- [Overview](${origin}/index.md): what Hokum is, installing and using it.

## Optional

- [Built-in themes](${origin}/themes/index.txt): ${themes.map((t) => `[${t.name}](${origin}/themes/${t.file})`).join(", ")}
- [Source code](${repo})
`

rmSync(dist, { recursive: true, force: true })
mkdirSync(join(dist, "themes"), { recursive: true })
writeFileSync(join(dist, "index.html"), html)
writeFileSync(join(dist, "themes.md"), themesDoc)
writeFileSync(join(dist, "theming.md"), themingDoc)
writeFileSync(join(dist, "index.md"), indexMd)
writeFileSync(join(dist, "llms.txt"), llms)
writeFileSync(join(dist, "favicon.svg"), favicon)
for (const f of readdirSync(join(root, "themes"))) cpSync(join(root, "themes", f), join(dist, "themes", f))
writeFileSync(
  join(dist, "themes", "index.txt"),
  readdirSync(join(root, "themes"))
    .filter((f) => f.endsWith(".kdl"))
    .map((f) => `${origin}/themes/${f}`)
    .join("\n") + "\n",
)
cpSync(join(site, "style.css"), join(dist, "style.css"))
cpSync(join(site, "assets"), join(dist, "assets"), { recursive: true })
if (existsSync(shots)) cpSync(shots, join(dist, "screenshots"), { recursive: true })
cpSync(join(site, "_headers"), join(dist, "_headers"))
writeFileSync(
  join(dist, "404.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found · Hokum</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/style.css"></head><body><main class="wrap section notfound"><h1>Nothing here.</h1><p><a href="/">Back to hokum.app</a></p></main></body></html>\n`,
)
console.log(`built ${dist}: ${themes.length} themes, ${features.length} features`)

// Builds hokum.app into site/dist from the repository: README.md, docs/theming.md,
// docs/themes.md and themes/*.kdl. The hero is story.js (the script) and hero.js (the cards).
//
// The site is one URL. dist/index.html is the page for browsers; dist/page.md is the same page
// as one self-contained markdown document, which worker.ts serves at / to agents.
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
  "Read https://hokum.app and create a Hokum theme for me, then switch my config to it. I want it to look like: "

const read = (path: string) => readFileSync(join(root, path), "utf8")
const readme = read("README.md")
const themesDoc = read("docs/themes.md")
const themingDoc = read("docs/theming.md")
const version = read("Cargo.toml").match(/^version = "(.+)"/m)?.[1] ?? ""

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

// GitHub's heading anchors: lower case, punctuation dropped, spaces to dashes.
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-")

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

const readmeParts = sections(readme)
const tagline = readme.split("\n\n")[1].trim()
const intro = readmeParts[""].split("\n\n").slice(2).join("\n\n").trim()
const use = readmeParts["Use"]
const installMd = readmeParts["Install"]

// Built-in themes, in the order README lists them, the default first.
const listed = readme.match(/built in \(([^)]+)\)/)?.[1].split(/,\s*/) ?? []
const defaultTheme = readme.match(/(\w+), with app icons, is the default/)?.[1] ?? "Capsule"
const themes = readdirSync(join(root, "themes"))
  .filter((f) => f.endsWith(".kdl") && f !== "default.kdl")
  .map((f) => {
    const id = f.replace(/\.kdl$/, "")
    const source = read(`themes/${f}`)
    const name = source.match(/^name "(.+)"/m)?.[1] ?? id
    const comment = source
      .split("\n")
      .filter((l) => l.startsWith("//"))
      .map((l) => l.replace(/^\/\/\s?/, ""))
      .join(" ")
      .replace(/^\S+:\s*/, "")
      .replace(/\s*The default\.$/, "")
      .replace(/^./, (c) => c.toUpperCase())
    return { id, name, comment, file: f, source }
  })
  .sort((a, b) => order(a.name) - order(b.name))
function order(name: string) {
  return name === defaultTheme ? -1 : listed.indexOf(name) >>> 0
}
const defaultCard = read("themes/default.kdl")

// "- **Label:** text" bullets in README's Use section are the feature list.
const features = [...use.matchAll(/^- \*\*(.+?):\*\* ([\s\S]+?)(?=\n- |\n\n|(?![\s\S]))/gm)].map((m) => ({
  title: m[1],
  md: m[2].replace(/\s*\n\s*/g, " ").replace(/^./, (c) => c.toUpperCase()),
}))
const usageCode = use.match(/```sh\n([\s\S]+?)```/)?.[1].trimEnd() ?? ""
const usageProse = use
  .replace(/```sh\n[\s\S]+?```/, "")
  .replace(/^- [\s\S]+?(?=\n\n[^-])/m, "")
  .trim()

// ---------------------------------------------------------------------------------------------
// The markdown document: README, theming.md, themes.md and the built-in themes' sources, with
// headings moved under one title and every link between them pointing at a heading.

type Doc = { key: string; title: string; md: string }

const builtInTitle = "Built-in theme sources"
const themeHeading = (name: string, file: string) => `${name} (${file})`
const docs: Doc[] = [
  { key: "readme-install", title: "Install", md: `# Install\n\n${installMd}` },
  { key: "readme-use", title: "Use", md: `# Use\n\n${use}` },
  { key: "theming", title: "Configuration", md: themingDoc },
  { key: "themes", title: "Writing a theme", md: themesDoc },
]

// Walk markdown lines outside code fences.
function mapLines(md: string, f: (line: string) => string) {
  let fence = false
  return md
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fence = !fence
        return line
      }
      return fence ? line : f(line)
    })
    .join("\n")
}

// Final anchors in document order, deduplicated the way GitHub does (`-1`, `-2`).
const used = new Map<string, number>()
const anchors = new Map<string, string>() // `${doc}#${original slug}` → final slug
function claim(text: string) {
  const base = slug(text)
  const n = used.get(base) ?? 0
  used.set(base, n + 1)
  return n ? `${base}-${n}` : base
}
claim("Hokum")
for (const doc of docs) {
  mapLines(doc.md, (line) => {
    const m = line.match(/^(#{1,6})\s+(.+)$/)
    if (!m) return line
    const text = m[1].length === 1 ? doc.title : m[2].replace(/`/g, "")
    anchors.set(`${doc.key}#${m[1].length === 1 ? "" : slug(m[2].replace(/`/g, ""))}`, claim(text))
    return line
  })
}
anchors.set("builtin#", claim(builtInTitle))
for (const t of [...themes.map((t) => ({ name: t.name, file: t.file })), { name: "The built-in card", file: "default.kdl" }])
  anchors.set(`kdl#${t.file}`, claim(themeHeading(t.name, t.file)))

function mdHref(href: string, doc: string) {
  if (href.startsWith("#")) return `#${anchors.get(`${doc}#${href.slice(1)}`) ?? href.slice(1)}`
  if (/^[a-z]+:/i.test(href)) return href
  const [path, hash] = href.split("#")
  const name = path.split("/").pop()
  if (name === "themes.md") return `#${anchors.get(`themes#${hash ?? ""}`)}`
  if (name === "theming.md") return `#${anchors.get(`theming#${hash ?? ""}`)}`
  const kdl = path.match(/themes\/([\w-]+\.kdl)$/)
  if (kdl && anchors.has(`kdl#${kdl[1]}`)) return `#${anchors.get(`kdl#${kdl[1]}`)}`
  return github(href)
}

function github(href: string) {
  const [path, hash] = href.split("#")
  const clean = path.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "")
  return `${repo}/${clean.includes(".") ? "blob" : "tree"}/dev/${clean}${hash ? `#${hash}` : ""}`
}

function embed(doc: Doc) {
  return mapLines(doc.md, (line) => {
    const h = line.match(/^(#{1,6})\s+(.+)$/)
    if (h) return h[1].length === 1 ? `## ${doc.title}` : `#${line}`
    return line.replace(/\]\(([^)\s]+)\)/g, (_, href: string) => `](${mdHref(href, doc.key)})`)
  }).trim()
}

const markdown = `# Hokum

${tagline}

${intro}

This is ${origin}, the whole site as one markdown document: installing and using Hokum, the
configuration reference, the complete guide to writing a theme, and the source of every
built-in theme. Browsers get the same page as HTML, which opens on a crime story told entirely
in notification cards, stacking up in the corner of a desktop. If you are a coding agent asked to make a
Hokum theme, read [Writing a theme](#${anchors.get("themes#")}) and
[Checking your work](#${anchors.get("themes#checking-your-work")}), then write the theme file
and set \`theme "<id>"\` in the user's config.

${docs.map(embed).join("\n\n")}

## ${builtInTitle}

The built-in themes, as Hokum ships them. A theme of your own can start from one with
\`theme "<id>"\`, or copy and change it.

${[...themes.map((t) => ({ name: t.name, file: t.file, source: t.source })), { name: "The built-in card", file: "default.kdl", source: defaultCard }]
  .map((t) => `### ${themeHeading(t.name, t.file)}\n\n\`\`\`kdl\n${t.source.trimEnd()}\n\`\`\``)
  .join("\n\n")}

## License

MIT. Source: ${repo}
`

// ---------------------------------------------------------------------------------------------
// The HTML page.

// Links on the page: sections of the page or GitHub.
function rewrite(href: string, prefix: string) {
  if (href.startsWith("#")) return `#${prefix}-${href.slice(1)}`
  if (/^[a-z]+:/i.test(href)) return href
  const [path, hash] = href.split("#")
  const name = path.split("/").pop()
  if (name === "themes.md") return hash ? `#guide-${hash}` : "#guide"
  if (name === "theming.md") return hash ? `#config-${hash}` : "#reference"
  return github(href)
}

// A renderer for one document: its h1 is dropped, other headings move down a level and get
// ids under `prefix`.
function renderer(prefix: string) {
  return new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        if (depth === 1) return ""
        const html = this.parser.parseInline(tokens)
        const id = `${prefix}-${slug(html)}`
        const level = Math.min(depth + 1, 6)
        return `<h${level} id="${id}"><a href="#${id}">${html}</a></h${level}>\n`
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
const render = (md: string, prefix: string) => renderer(prefix).parse(md) as string
const inline = (md: string, prefix: string) => renderer(prefix).parseInline(md) as string

// Install: one tab per way, as the README gives them. Each "On …:" / "From …:" paragraph and the
// code under it is a tab.
const installTabs: { id: string; label: string; code: string }[] = []
for (const m of installMd.slice(0, installMd.indexOf("Hokum starts through D-Bus") >>> 0).matchAll(/^(.+?):\n\n```sh\n([\s\S]+?)```/gm)) {
  const lead = m[1].replace(/\s*\n\s*/g, " ")
  const [id, label] = /AUR/.test(lead)
    ? ["arch", "Arch"]
    : /Debian/.test(lead)
      ? ["debian", "Debian / Ubuntu"]
      : /Fedora/.test(lead)
        ? ["fedora", "Fedora / openSUSE"]
        : [slug(lead), lead]
  installTabs.push({ id, label, code: m[2].trimEnd() })
}
const serviceMd = installMd.slice(installMd.indexOf("Hokum starts through D-Bus") >>> 0)
const serviceCode = serviceMd.match(/```sh\n([\s\S]+?)```/)?.[1].trim() ?? ""
const serviceProse = serviceMd.replace(/```sh\n[\s\S]+?```/, "").trim()
const binaryProse = installMd.match(/^Or download[\s\S]+?(?=\n\n)/m)?.[0].replace(/\s*\n\s*/g, " ") ?? ""

const shell = (code: string) =>
  code
    .split("\n")
    .map((l) => {
      const [cmd, comment] = l.split(/(?<=\S)\s+(?=# )/)
      return `<span class="cmd">${escape(cmd)}</span>${comment ? `  <span class="out">${escape(comment)}</span>` : ""}`
    })
    .join("\n")

const binaryHtml = `<div class="downloads">${[
  ["x64", "x86_64"],
  ["arm64", "ARM64"],
]
  .map(
    ([arch, label]) =>
      `<div><span>${label}</span><a href="${release}/linux-${arch}">executable</a><a href="${release}/linux-${arch}-deb">.deb</a><a href="${release}/linux-${arch}-rpm">.rpm</a></div>`,
  )
  .join("")}</div>`

// The theme guide's own intro paragraph is replaced by the section's lead.
const guideBody = themesDoc.replace(/^# .+\n\n[\s\S]+?\n\n(?=## )/, "")
const configExample = themingDoc.match(/```kdl\n([\s\S]+?)```/)?.[1].trimEnd() ?? ""
const configLead = themingDoc.match(/^# .+\n\n([\s\S]+?)\n\n```/)?.[1] ?? ""
const configRest = themingDoc.replace(/^# .+\n\n[\s\S]+?```kdl\n[\s\S]+?```\n\n/, "")
const firstSentence = (md: string) => md.match(/^[\s\S]+?[.!?](?=\s|$)/)?.[0] ?? md

const mark = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="6" width="26" height="9" rx="4.5" fill="currentColor" opacity=".45"/><rect x="3" y="17" width="26" height="9" rx="4.5" fill="currentColor"/></svg>`
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#111114"/><rect x="5" y="7" width="22" height="8" rx="4" fill="#fff" opacity=".45"/><rect x="5" y="17" width="22" height="8" rx="4" fill="#fff"/></svg>`
const year = new Date().getFullYear()
const githubIcon = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`

const firstTab = installTabs[0]

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Hokum — notifications for Wayland</title>
<meta name="description" content="${escape(tagline)}">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#1b1b2e">
<meta property="og:type" content="website">
<meta property="og:title" content="Hokum — notifications for Wayland">
<meta property="og:description" content="${escape(tagline)}">
<meta property="og:url" content="${origin}/">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="text/markdown" href="/?format=md" title="This page as markdown, for agents">
<link rel="preload" href="/assets/inter.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div class="desk" id="desk">
  <div class="wall" aria-hidden="true"><div class="stars"></div></div>
  <header class="bar" aria-hidden="true">
    <div class="ws"><i class="on"></i><i></i><i></i></div>
    <div class="clock" id="clock"></div>
    <div class="tray">
      <svg viewBox="0 0 16 16"><path d="M1.5 6a9.5 9.5 0 0 1 13 0M3.8 8.6a6.2 6.2 0 0 1 8.4 0M6 11.1a3 3 0 0 1 4 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="13.4" r="1" fill="currentColor"/></svg>
      <svg viewBox="0 0 22 16"><rect x="1" y="4" width="17" height="8" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="3" y="6" width="9" height="4" rx="1" fill="currentColor"/><rect x="19" y="6.5" width="1.6" height="3" rx=".8" fill="currentColor"/></svg>
    </div>
  </header>
  <div class="stack" id="stack" aria-live="polite" aria-label="Notifications"></div>
  <div class="more" id="more" aria-hidden="true"></div>
  <nav class="controls" aria-label="Story">
    <button id="skip" type="button">Skip</button>
    <button id="replay" type="button">Replay</button>
  </nav>
  <section class="hero" id="hero">
    <h1>${mark}hokum</h1>
    <p class="tag">${escape(tagline)}</p>
    <button class="install copy" type="button" data-copy="${escape(firstTab.code)}" title="Copy to clipboard"><span class="p">$</span> ${escape(firstTab.code)} <span class="hint">copy</span></button>
    <p class="alt">
      <a href="${release}/linux-x64-deb">.deb</a>
      <a href="${release}/linux-x64-rpm">.rpm</a>
      <a href="${release}/linux-arm64-deb">arm64 .deb</a>
      <a href="${release}/linux-arm64-rpm">arm64 .rpm</a>
      <a href="#install">more</a>
    </p>
  </section>
</div>

<main>
<section id="themes" class="themes">
  <div class="section-head">
    <h2><a href="#themes">Themes</a></h2>
    <p>${themes.length} built in. ${escape(defaultTheme)}, the one above, is the default. Pick another in the settings window or set <code>theme "&lt;id&gt;"</code> in <code>config.kdl</code>.</p>
  </div>
  <div class="theme-list">
${themes.map((t) => `    <div class="theme"><span class="name">${escape(t.name)}</span><code>theme "${t.id}"</code><span class="desc">${escape(t.comment)}</span></div>`).join("\n")}
  </div>
</section>

<section id="features" class="features">
${features.map((f) => `  <div><h3>${escape(f.title)}</h3><p>${inline(firstSentence(f.md), "use")}</p></div>`).join("\n")}
</section>

<section id="install" class="split">
  <div class="section-head"><h2><a href="#install">Install</a></h2></div>
  <div class="prose">
${installTabs.map((t) => `    <h3>${escape(t.label)}</h3>\n    <pre class="term"><code>${shell(t.code)}</code></pre>`).join("\n")}
    <h3>Download</h3>
    ${binaryHtml}
    <p>${inline(binaryProse, "install")}</p>
    <h3 id="service">Start with your session</h3>
    ${render(serviceProse, "install")}
    <pre class="term"><code>${shell(serviceCode)}</code></pre>
  </div>
</section>

<section id="use" class="split">
  <div class="section-head"><h2><a href="#use">Use</a></h2></div>
  <div class="prose">
    <pre class="term"><code>${shell(usageCode)}</code></pre>
    ${render(usageProse, "use")}
  </div>
</section>

<section id="guide" class="split">
  <div class="section-head"><h2><a href="#guide">Make your own theme</a></h2></div>
  <div class="prose">
    <p>Custom themes are written by your coding agent. Copy this prompt and finish the sentence with the look you want. The agent reads this page (fetched by an agent, ${origin} is one markdown document with the whole guide and every built-in theme's source), writes the theme, checks it with <code>hokum check</code>, renders it to look at it, and switches your config to it.</p>
    <div class="prompt"><code id="prompt">${escape(prompt)}</code><button type="button" class="copy" data-copy-from="#prompt">Copy</button></div>
    <p class="hint">The same prompt is under <b>Make your own theme</b> in Hokum's settings window.</p>
    <details id="guide-reference">
      <summary>The theme guide</summary>
      <div class="doc">${render(guideBody, "guide")}</div>
    </details>
  </div>
</section>

<section id="configure" class="split">
  <div class="section-head"><h2><a href="#configure">Configure</a></h2></div>
  <div class="prose">
    ${render(configLead, "config")}
    <pre class="code"><code>${escape(configExample)}</code></pre>
    <details id="reference">
      <summary>The configuration reference</summary>
      <div class="doc">${render(configRest, "config")}</div>
    </details>
  </div>
</section>
</main>

<footer class="foot">
  <span class="brand">${mark}<span>Hokum</span><span class="dim">v${escape(version)}</span></span>
  <nav><a href="${repo}" rel="noopener">${githubIcon}GitHub</a><a href="${repo}/blob/dev/LICENSE" rel="noopener">MIT License</a><a href="/?format=md">Markdown</a><a href="https://anoma.ly">© ${year} Anomaly</a></nav>
</footer>
<script src="/story.js"></script>
<script src="/hero.js"></script>
<script src="/site.js"></script>
</body>
</html>
`

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })
writeFileSync(join(dist, "index.html"), html)
writeFileSync(join(dist, "page.md"), markdown)
writeFileSync(join(dist, "favicon.svg"), favicon)
cpSync(join(site, "style.css"), join(dist, "style.css"))
cpSync(join(site, "assets"), join(dist, "assets"), { recursive: true })
cpSync(join(site, "_headers"), join(dist, "_headers"))
for (const f of ["story.js", "hero.js", "site.js"]) cpSync(join(site, f), join(dist, f))
console.log(`built ${dist}: ${themes.length} themes, ${features.length} features, ${installTabs.length} install tabs, ${markdown.length} bytes of markdown`)

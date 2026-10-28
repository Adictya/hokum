// Builds hokum.app into site/dist from the repository: README.md, docs/theming.md,
// docs/themes.md, themes/*.kdl and the rendered screenshots in site/screenshots.
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
built-in theme. Browsers get the same page as HTML. If you are a coding agent asked to make a
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

const shots = join(site, "screenshots")
const shot = (id: string, mode: string) => existsSync(join(shots, `${id}-${mode}.webp`))
// WebP headers carry the canvas size; read it so images reserve their space.
function size(id: string) {
  const b = readFileSync(join(shots, `${id}-dark.webp`))
  const fourcc = b.toString("ascii", 12, 16)
  if (fourcc === "VP8X") return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)]
  if (fourcc === "VP8L") {
    const bits = b.readUInt32LE(21)
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1]
  }
  return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]
}
function picture(id: string, alt: string) {
  if (!shot(id, "dark")) return `<div class="missing">${escape(alt)}</div>`
  const [w, h] = size(id)
  const light = shot(id, "light")
    ? `<source srcset="/screenshots/${id}-light.webp" media="(prefers-color-scheme: light)">`
    : ""
  return `<picture>${light}<img src="/screenshots/${id}-dark.webp" width="${w}" height="${h}" alt="${escape(alt)}" decoding="async"></picture>`
}

// Install: one tab per way, as the README gives them. Each "On …:" / "From …:" paragraph and the
// code under it is a tab; the rest is prose under the tabs.
const installTabs: { label: string; note: string; code: string }[] = []
for (const m of installMd.slice(0, installMd.indexOf("Hokum starts through D-Bus") >>> 0).matchAll(/^(.+?):\n\n```sh\n([\s\S]+?)```/gm)) {
  const lead = m[1].replace(/\s*\n\s*/g, " ")
  const label = /AUR/.test(lead)
    ? "arch"
    : /Debian/.test(lead)
      ? "debian"
      : /Fedora/.test(lead)
        ? "fedora"
        : lead.toLowerCase().split(" ").pop()!
  installTabs.push({ label, note: lead, code: m[2].trimEnd() })
}
const serviceAt = installMd.indexOf("Hokum starts through D-Bus")
const serviceMd = serviceAt < 0 ? "" : installMd.slice(serviceAt).trim()
const serviceCode = serviceMd.match(/```sh\n([\s\S]+?)```/)?.[1].trim() ?? ""
const serviceProse = serviceMd.replace(/```sh\n[\s\S]+?```/, "").trim()
const binaryProse = installMd.match(/^Or download[\s\S]+?(?=\n\n)/m)?.[0] ?? ""

const shell = (code: string) =>
  code
    .split("\n")
    .map((l) => {
      const [cmd, comment] = l.split(/(?<=\S)\s+(?=# )/)
      return `<span class="cmd">${escape(cmd)}</span>${comment ? ` <span class="out">${escape(comment)}</span>` : ""}`
    })
    .join("\n")

const tabs = [
  ...installTabs.map((t) => ({ ...t, html: `<pre class="term"><code>${shell(t.code)}</code></pre><p class="note">${inline(t.note, "install")}</p>` })),
  {
    label: "binary",
    html: `<div class="table"><table><tbody>${[
      ["x64", "x86_64"],
      ["arm64", "aarch64"],
    ]
      .map(
        ([arch, label]) =>
          `<tr><th>${label}</th><td><a href="${release}/linux-${arch}">executable</a></td><td><a href="${release}/linux-${arch}-deb">.deb</a></td><td><a href="${release}/linux-${arch}-rpm">.rpm</a></td></tr>`,
      )
      .join("")}</tbody></table></div><p class="note">${inline(binaryProse.replace(/\s*\n\s*/g, " "), "install")}</p>`,
  },
]

// The theme guide's own intro paragraph is replaced by the section's lead.
const guideBody = themesDoc.replace(/^# .+\n\n[\s\S]+?\n\n(?=## )/, "")
// The configuration reference: the first example leads the section, the rest folds away.
const configExample = themingDoc.match(/```kdl\n([\s\S]+?)```/)?.[1].trimEnd() ?? ""
const configLead = themingDoc.match(/^# .+\n\n([\s\S]+?)\n\n```/)?.[1] ?? ""
const configRest = themingDoc.replace(/^# .+\n\n[\s\S]+?```kdl\n[\s\S]+?```\n\n/, "")

const icon = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="6" width="26" height="9" rx="4.5" fill="currentColor" opacity=".4"/><rect x="3" y="17" width="26" height="9" rx="4.5" fill="currentColor"/></svg>`
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#000"/><rect x="5" y="7" width="22" height="8" rx="4" fill="#fff" opacity=".45"/><rect x="5" y="17" width="22" height="8" rx="4" fill="#fff"/></svg>`
const year = new Date().getFullYear()

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>hokum — notifications for wayland</title>
<meta name="description" content="${escape(tagline)}">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta property="og:type" content="website">
<meta property="og:title" content="hokum — notifications for wayland">
<meta property="og:description" content="${escape(tagline)}">
<meta property="og:url" content="${origin}/">
<meta property="og:image" content="${origin}/screenshots/${themes[0].id}-dark.webp">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="text/markdown" href="/?format=md" title="This page as markdown, for agents">
<link rel="preload" href="/assets/inter.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/ibm-plex-mono-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<main>
  <header class="masthead">
    <h1 class="wordmark">${icon}<span>hokum</span></h1>
    <p class="caption"><b>notifications<i></i>for wayland</b><b>v${escape(version)}<i></i>mit</b></p>
  </header>

  <p class="tagline">${escape(tagline.toLowerCase().replace(/\.$/, ""))}</p>
  <div class="intro">${render(intro, "intro")}</div>

  <div class="install" role="group" aria-label="Install">
${tabs.map((t, i) => `    <input type="radio" name="install" id="tab-${t.label}"${i === 0 ? " checked" : ""}>`).join("\n")}
    <div class="tabs">${tabs.map((t) => `<label for="tab-${t.label}">${t.label}</label>`).join("")}<a href="${repo}/releases" rel="noopener">github</a></div>
${tabs.map((t) => `    <div class="panel" id="panel-${t.label}">${t.html}</div>`).join("\n")}
  </div>

  <section id="themes" class="themes">
    <h2><a href="#themes">themes</a></h2>
    <p class="lead">${themes.length} built in, rendered here by Hokum itself. ${escape(defaultTheme)} is the default; pick one in the settings window or set <code>theme "&lt;id&gt;"</code> in <code>config.kdl</code>. They follow light and dark, as your desktop does.</p>
    <div class="gallery">
${themes
  .map(
    (t) => `      <figure class="theme" id="theme-${t.id}">
        <div class="desktop">${picture(t.id, `The ${t.name} theme: a Slack message, a critical battery warning, a volume bar and a download`)}</div>
        <figcaption><span class="name">${t.id}</span>${t.name === defaultTheme ? '<span class="dim">default</span>' : ""}<p>${escape(t.comment)}</p></figcaption>
      </figure>`,
  )
  .join("\n")}
    </div>
  </section>

  <section id="use">
    <h2><a href="#use">use</a></h2>
    <pre class="term"><code>${shell(usageCode)}</code></pre>
    <div class="prose">${render(usageProse, "use")}${render(serviceProse, "install")}</div>
    <pre class="term after"><code>${shell(serviceCode)}</code></pre>
    <dl class="features">
${features.map((f) => `      <div><dt>${escape(f.title.toLowerCase())}</dt><dd>${inline(f.md, "use")}</dd></div>`).join("\n")}
    </dl>
  </section>

  <section id="guide">
    <h2><a href="#guide">make your own theme</a></h2>
    <ol class="steps">
      <li><p>Custom themes are written by your coding agent. Copy the prompt and finish the sentence with the look you want.</p></li>
      <li><p>The agent reads this page (fetched by an agent, ${origin} is one markdown document with the whole guide and every built-in theme's source).</p></li>
      <li><p>It writes <code>~/.config/hokum/themes/&lt;id&gt;.kdl</code>, checks it with <code>hokum check</code>, renders it headlessly to look at it, and switches your config to it. Hokum redraws as the file changes.</p></li>
    </ol>
    <div class="prompt"><code id="prompt">${escape(prompt)}</code><button type="button" class="copy" data-copy="#prompt">copy</button></div>
    <p class="hint">The same prompt is under <b>Make your own theme</b> in Hokum's settings window.</p>
    <details id="guide-reference">
      <summary>the theme guide</summary>
      <div class="prose doc">${render(guideBody, "guide")}</div>
    </details>
  </section>

  <section id="configure">
    <h2><a href="#configure">configure</a></h2>
    <div class="prose">${render(configLead, "config")}</div>
    <pre class="code" data-lang="kdl"><code>${escape(configExample)}</code></pre>
    <details id="reference">
      <summary>the configuration reference</summary>
      <div class="prose doc">${render(configRest, "config")}</div>
    </details>
  </section>
</main>

<footer class="foot">
  <p><a href="${repo}" rel="noopener">github</a><a href="${repo}/blob/dev/LICENSE" rel="noopener">mit license</a><a href="/?format=md">markdown</a></p>
  <p>©${year} <a href="https://anoma.ly">anomaly</a></p>
</footer>
<script>
for (const pre of document.querySelectorAll("pre.code, pre.term")) {
  const b = document.createElement("button")
  b.type = "button"; b.className = "copy"; b.textContent = "copy"
  const text = [...pre.querySelectorAll(".cmd")].map((c) => c.textContent).join("\\n") || pre.querySelector("code").textContent
  b.addEventListener("click", () => copy(b, text.trimEnd()))
  pre.append(b)
}
for (const b of document.querySelectorAll("button[data-copy]"))
  b.addEventListener("click", () => copy(b, document.querySelector(b.dataset.copy).textContent))
function copy(b, text) {
  navigator.clipboard.writeText(text).then(() => {
    b.textContent = "copied"; setTimeout(() => (b.textContent = "copy"), 1500)
  })
}
function reveal() {
  const el = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)))
  const details = el && el.closest("details")
  if (details && !details.open) { details.open = true; el.scrollIntoView() }
}
addEventListener("hashchange", reveal)
reveal()
</script>
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
if (existsSync(shots)) cpSync(shots, join(dist, "screenshots"), { recursive: true })
cpSync(join(site, "_headers"), join(dist, "_headers"))
console.log(`built ${dist}: ${themes.length} themes, ${features.length} features, ${installTabs.length} install tabs, ${markdown.length} bytes of markdown`)

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

// Other Anomaly products, for the header's switcher. Icons are drawn here, not loaded.
const products = [
  { name: "opencode", line: "The open source coding agent.", url: "https://opencode.ai", repo: "https://github.com/anomalyco/opencode",
    icon: `<rect width="32" height="32" rx="8" fill="#211e1e"/><path d="M10 9h12v14H10z" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M13 16h6v4h-6z" fill="#fff" opacity=".45"/>` },
  { name: "Hex", line: "Local voice dictation: hold a key, speak, and it appears.", url: "https://hex.kitlangton.com", repo: "https://github.com/anomalyco/hex",
    icon: `<rect width="32" height="32" rx="8" fill="#141414"/><path d="M16 6.5l8.2 4.75v9.5L16 25.5l-8.2-4.75v-9.5z" fill="none" stroke="#fff" stroke-width="1.8"/><path d="M16 12.5l3.1 1.8v3.4L16 19.5l-3.1-1.8v-3.4z" fill="#ffb347"/>` },
  { name: "opentunnel", line: "End-to-end encrypted public URLs for apps on your machine.", url: "https://opentunnel.xyz", repo: "https://github.com/anomalyco/opentunnel",
    icon: `<rect width="32" height="32" rx="8" fill="#000"/><path d="M7 24V16a9 9 0 0 1 18 0v8" fill="none" stroke="#ff2a2a" stroke-width="2.2"/><path d="M11.5 24v-8a4.5 4.5 0 0 1 9 0v8" fill="none" stroke="#ff2a2a" stroke-width="2.2" opacity=".55"/>` },
  { name: "OpenTUI", line: "A library for building terminal user interfaces.", url: "https://opentui.com", repo: "https://github.com/anomalyco/opentui",
    icon: `<rect width="32" height="32" rx="8" fill="#0f172a"/><rect x="6.5" y="8.5" width="19" height="15" rx="2" fill="none" stroke="#e2e8f0" stroke-width="1.6"/><path d="M10 13.5l3 2.5-3 2.5M15 19h6" fill="none" stroke="#5eead4" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>` },
  { name: "models.dev", line: "An open source database of AI models.", url: "https://models.dev", repo: "https://github.com/anomalyco/models.dev",
    icon: `<rect width="32" height="32" rx="8" fill="#18181b"/><g fill="#fff"><rect x="8" y="8" width="7" height="7" rx="1.5"/><rect x="17" y="8" width="7" height="7" rx="1.5" opacity=".55"/><rect x="8" y="17" width="7" height="7" rx="1.5" opacity=".55"/><rect x="17" y="17" width="7" height="7" rx="1.5" opacity=".3"/></g>` },
]
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
in notification cards, stacking up in the corner of a desktop, with one of six endings picked at
random. If you are a coding agent asked to make a
Hokum theme, read [Writing a theme](#${anchors.get("themes#")}) and
[Checking your work](#${anchors.get("themes#checking-your-work")}), then write the theme file
and set \`theme "<id>"\` in the user's config.

${embed(docs[0])}

## Features

${features.map((f) => `- **${f.title}:** ${f.md}`).join("\n")}

${docs.slice(1).map(embed).join("\n\n")}

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

// No Hokum logo yet: the favicon is a plain lettermark.
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#111114"/><text x="16" y="22.5" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="19" font-weight="700" fill="#f2f2ef">H</text></svg>`
const year = new Date().getFullYear()
const githubIcon = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`

const productIcon = (p: { icon: string }) => `<svg viewBox="0 0 32 32" aria-hidden="true">${p.icon}</svg>`
const hokumProductIcon = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#26263a"/><text x="16" y="22" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="17" font-weight="700" fill="#fff">H</text></svg>`
// Anomaly's mark, drawn: a grid with one thing out of place.
const anomalyMark = `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><rect x="3" y="3" width="5" height="5" rx="1"/><rect x="10" y="3" width="5" height="5" rx="1"/><rect x="3" y="10" width="5" height="5" rx="1"/><rect x="10" y="10" width="5" height="5" rx="1"/><rect x="3" y="17" width="5" height="5" rx="1"/><rect x="10" y="17" width="5" height="5" rx="1"/><rect x="17.5" y="15.5" width="5" height="5" rx="1" transform="rotate(14 20 18)"/></g></svg>`
const opencodeMark = `<svg viewBox="0 0 16 20" aria-hidden="true"><path d="M2 2h12v16H2z" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M5.2 10h5.6v4.8H5.2z" fill="currentColor" opacity=".5"/></svg>`

// The install CTA: a terminal with one tab per platform, each one install command. site.js picks the visitor's platform (Arch unless the browser says
// Ubuntu, Debian or Fedora) and CPU; without JavaScript the radios still switch.
type Cmd = string | { x64: string; arm64: string }
const tabCode = (id: string) => installTabs.find((t) => t.id === id)!.code.split("\n").join(" && ")
const perCpu = (code: string): Cmd => ({ x64: code, arm64: code.replace(/linux-x64/g, "linux-arm64") })
const local = "~/.local/bin/hokum"
const install: { id: string; label: string; short: string; lines: { note: string; code: Cmd }[]; foot: string }[] = []
const cpuSwitch = (id: string) => `<div class="tty-seg tty-cpu" aria-hidden="true"><label class="x64" for="c-${id}-x64">x86_64</label><label class="arm64" for="c-${id}-arm64">arm64</label></div>`
const perCpuLink = (path: (cpu: string) => string, text: string) =>
  `<a class="cpu-x64" href="${path("x64")}">${text}</a><a class="cpu-arm64" href="${path("arm64")}">${text}</a>`
const down = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5v8M2.5 6 6 9.5 9.5 6M2 11h8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
const out = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2h6v6M10 2 2.5 9.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
install.push(
  { id: "arch", label: "Arch", short: "Arch", lines: [{ note: "install from the AUR", code: tabCode("arch") }],
    foot: `<span class="tty-meta">AUR <b>hokum-bin</b></span><span class="tty-links"><a href="https://aur.archlinux.org/packages/hokum-bin" rel="noopener">AUR page${out}</a></span>` },
  { id: "debian", label: "Debian / Ubuntu", short: "Debian", lines: [{ note: "download and install the .deb", code: perCpu(tabCode("debian")) }],
    foot: `${cpuSwitch("debian")}<span class="tty-links">${perCpuLink((c) => `${release}/linux-${c}-deb`, `.deb${down}`)}</span>` },
  { id: "fedora", label: "Fedora / openSUSE", short: "Fedora", lines: [{ note: "download and install the .rpm", code: perCpu(tabCode("fedora")) }],
    foot: `${cpuSwitch("fedora")}<span class="tty-links">${perCpuLink((c) => `${release}/linux-${c}-rpm`, `.rpm${down}`)}</span>` },
  { id: "binary", label: "Other Linux", short: "Other", lines: [
      { note: "download the executable onto your PATH", code: perCpu(`curl -fLo ${local} ${release}/linux-x64 && chmod +x ${local}`) }],
    foot: `${cpuSwitch("binary")}<span class="tty-links">${perCpuLink((c) => `${release}/linux-${c}`, `Executable${down}`)}<a href="${repo}/releases" rel="noopener">Releases${out}</a></span>` },
)

// Shell, lightly coloured: commands, flags, URLs and paths. URLs may break after a slash.
function highlight(code: string) {
  let head = true
  return code
    .split(" ")
    .map((w) => {
      const t = escape(w)
      if (w === "&&") return (head = true), `<span class="t-op">${t}</span>`
      if (head) return (head = w === "sudo"), `<span class="t-cmd">${t}</span>`
      if (w.startsWith("-")) return `<span class="t-flag">${t}</span>`
      if (/^https?:/.test(w)) return `<span class="t-url">${t.replace(/\//g, "/<wbr>")}</span>`
      if (/^[~/]/.test(w)) return `<span class="t-path">${t}</span>`
      return t
    })
    .join(" ")
}
const copyIcon = `<svg class="i-copy" viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10.5 3.6V3.3c0-1-.8-1.8-1.8-1.8H3.3c-1 0-1.8.8-1.8 1.8v5.4c0 1 .8 1.8 1.8 1.8h.3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg><svg class="i-done" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
const cmdLine = (code: string, cls = "") =>
  `<div class="tty-line${cls}"><code>${highlight(code)}</code><button type="button" class="tty-copy" data-copy="${escape(code)}" aria-label="Copy: ${escape(code)}" hidden>${copyIcon}</button></div>`
const lines = (l: { note: string; code: Cmd }) =>
  `<p class="tty-note"># ${escape(l.note)}</p>` +
  (typeof l.code === "string" ? cmdLine(l.code) : cmdLine(l.code.x64, " cpu-x64") + cmdLine(l.code.arm64, " cpu-arm64"))
const installHtml = `<div class="tty" role="group" aria-label="Install Hokum">
${install.map((t, i) => `    <input class="sr" type="radio" name="platform" id="p-${t.id}" value="${t.id}"${i === 0 ? " checked" : ""} aria-label="${escape(t.label)}">`).join("\n")}
    <div class="tty-bar">
      <span class="tty-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <div class="tty-seg tty-tabs" aria-hidden="true">${install.map((t) => `<label for="p-${t.id}" title="${escape(t.label)}"><span class="long">${escape(t.label)}</span><span class="short">${escape(t.short)}</span></label>`).join("")}</div>
      <span class="tty-version" aria-hidden="true">v${escape(version)}</span>
    </div>
${install.map((t) => `    <div class="tty-panel" id="panel-${t.id}">${t.foot.includes("tty-cpu") ? `
      <input class="sr cpu-pick" type="radio" name="cpu-${t.id}" id="c-${t.id}-x64" value="x64" checked aria-label="x86_64 build">
      <input class="sr cpu-pick" type="radio" name="cpu-${t.id}" id="c-${t.id}-arm64" value="arm64" aria-label="ARM64 build">` : ""}
      <div class="tty-body">${t.lines.map(lines).join("")}</div>
      <div class="tty-foot">${t.foot}</div>
    </div>`).join("\n")}
    <span class="sr" role="status" aria-live="polite" id="copy-status"></span>
  </div>`

const clipTiles = [
  { id: "themes", title: "Eight themes built in", line: "One line of config switches the look. Or have your agent write a new one." },
  { id: "stack", title: "Springs, not slides", line: "Cards stack, restack and leave on real spring physics." },
  { id: "actions", title: "Buttons and progress", line: "Actions, progress bars, and volume that updates in place." },
  { id: "dnd", title: "Do not disturb", line: "Only critical cards, and the apps you allow, get through." },
]

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Hokum — notifications for Wayland</title>
<meta name="description" content="${escape(tagline)}">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#09090c">
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
<header class="top">
  <div class="switcher">
    <button type="button" class="switcher-button" aria-expanded="false" aria-controls="products-menu">
      <span class="current">Hokum</span>
      <span class="chev" aria-hidden="true"></span>
    </button>
    <div class="menu" id="products-menu" hidden>
      <p class="menu-head">Anomaly products</p>
      <a class="menu-item current" href="/" aria-current="page">${hokumProductIcon}<span><b>Hokum</b><i>Notifications for Wayland</i></span></a>
${products.map((p) => `      <a class="menu-item" href="${p.url}">${productIcon(p)}<span><b>${escape(p.name)}</b><i>${escape(p.line)}</i></span></a>`).join("\n")}
      <a class="menu-foot" href="https://anoma.ly">anoma.ly →</a>
    </div>
  </div>
  <a class="top-github" href="${repo}" rel="noopener">${githubIcon}<span>GitHub</span></a>
</header>

<div class="desk" id="desk">
  <div class="wall" aria-hidden="true"><div class="stars"></div></div>
  <div class="bar" aria-hidden="true">
    <div class="ws"><i class="on"></i><i></i><i></i></div>
    <div class="clock" id="clock"></div>
    <div class="tray">
      <svg viewBox="0 0 16 16"><path d="M1.5 6a9.5 9.5 0 0 1 13 0M3.8 8.6a6.2 6.2 0 0 1 8.4 0M6 11.1a3 3 0 0 1 4 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="13.4" r="1" fill="currentColor"/></svg>
      <svg viewBox="0 0 22 16"><rect x="1" y="4" width="17" height="8" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="3" y="6" width="9" height="4" rx="1" fill="currentColor"/><rect x="19" y="6.5" width="1.6" height="3" rx=".8" fill="currentColor"/></svg>
    </div>
  </div>
  <div class="stack" id="stack" aria-live="polite" aria-label="Notifications"></div>
  <div class="more" id="more" aria-hidden="true"></div>
  <nav class="controls" aria-label="Story">
    <button id="skip" type="button">Skip</button>
    <button id="replay" type="button">Replay</button>
  </nav>
</div>

<main>
<section class="intro">
  <h1>Notifications for Wayland.</h1>
  ${installHtml}
</section>

<section class="clips" aria-label="Features">
${clipTiles.map((c) => `  <figure class="clip" data-clip="${c.id}">
    <div class="clip-screen"${c.id === "themes" ? ' data-theme="capsule"' : ""}>${c.id === "themes" ? '<span class="clip-label">theme "capsule"</span>' : ""}${c.id === "dnd" ? '<span class="clip-dnd"><i></i>Do not disturb</span><span class="clip-held"></span>' : ""}</div>
    <figcaption><b>${escape(c.title)}</b> ${escape(c.line)}</figcaption>
  </figure>`).join("\n")}
</section>

<section class="more-about">
  <div class="about-grid">
    <h2>What you get</h2>
${features.map((f) => `    <div><h3>${escape(f.title)}</h3><p>${inline(firstSentence(f.md), "use")}</p></div>`).join("\n")}
  </div>

  <div class="docs">
    <div class="theme-prompt">
      <h2 id="guide">Make your own theme</h2>
      <p>Custom themes are written by your coding agent. Copy this prompt, finish the sentence with the look you want, and it reads this page (an agent fetching ${origin} gets the whole guide as markdown), writes the theme, checks it and switches your config to it.</p>
      <div class="prompt"><code id="prompt">${escape(prompt)}</code><button type="button" class="copy" data-copy-from="#prompt">Copy</button></div>
    </div>
    <details id="install">
      <summary>Every way to install</summary>
      <div class="doc">
${installTabs.map((t) => `        <h3>${escape(t.label)}</h3>\n        <pre class="term"><code>${shell(t.code)}</code></pre>`).join("\n")}
        <h3>Download</h3>
        ${binaryHtml}
        <p>${inline(binaryProse, "install")}</p>
        <h3 id="service">Start with your session</h3>
        ${render(serviceProse, "install")}
        <pre class="term"><code>${shell(serviceCode)}</code></pre>
      </div>
    </details>
    <details id="use">
      <summary>Usage</summary>
      <div class="doc">
        <pre class="term"><code>${shell(usageCode)}</code></pre>
        ${render(usageProse, "use")}
      </div>
    </details>
    <details id="themes">
      <summary>The built-in themes</summary>
      <div class="doc"><div class="theme-list">
${themes.map((t) => `        <div class="theme"><span class="name">${escape(t.name)}</span><code>theme "${t.id}"</code><span class="desc">${escape(t.comment)}</span></div>`).join("\n")}
      </div></div>
    </details>
    <details id="configure">
      <summary>Configuration reference</summary>
      <div class="doc">
        ${render(configLead, "config")}
        <pre class="code"><code>${escape(configExample)}</code></pre>
        ${render(configRest, "config")}
      </div>
    </details>
    <details id="guide-reference">
      <summary>The theme guide</summary>
      <div class="doc">${render(guideBody, "guide")}</div>
    </details>
  </div>
</section>

</main>

<footer class="foot">
  <a class="foot-brand" href="https://anoma.ly">${anomalyMark}<span>Anomaly</span></a>
  <nav>
    <a href="${repo}" rel="noopener">GitHub</a>
    <a href="${repo}/blob/dev/LICENSE" rel="noopener">MIT License</a>
    <a href="https://anoma.ly">anoma.ly</a>
    <a href="/?format=md">Markdown</a>
  </nav>
  <a class="built" href="https://opencode.ai" rel="noopener">${opencodeMark}<span>Built with <b>opencode</b></span></a>
</footer>
<script src="/story.js"></script>
<script src="/hero.js"></script>
<script src="/clips.js"></script>
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
for (const f of ["story.js", "hero.js", "clips.js", "site.js"]) cpSync(join(site, f), join(dist, f))
console.log(`built ${dist}: ${themes.length} themes, ${features.length} features, ${installTabs.length} install tabs, ${markdown.length} bytes of markdown`)

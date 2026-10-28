// The page around the hero: the product menu, the platform guess, copy buttons, and links into
// a folded section open it.

// Product switcher.
const switcher = document.querySelector(".switcher-button")
const menu = document.getElementById("products-menu")
function setMenu(open) {
  menu.hidden = !open
  switcher.setAttribute("aria-expanded", String(open))
}
switcher.addEventListener("click", (e) => {
  e.stopPropagation()
  setMenu(menu.hidden)
})
document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target)) setMenu(false) })
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) { setMenu(false); switcher.focus() } })

document.documentElement.classList.add("js")

// Which install to show first. Browsers rarely say the distribution; when they do, use it.
// `?platform=arch|debian|fedora|binary` overrides. The CPU comes from the user agent, or from
// client hints where the browser has them.
const ua = navigator.userAgent
const forced = new URLSearchParams(location.search).get("platform")
const guess = forced || (/Ubuntu|Debian|Mint|Pop!_OS/i.test(ua) ? "debian" : /Fedora|SUSE|Red Hat|CentOS/i.test(ua) ? "fedora" : "arch")
const radio = document.getElementById("p-" + guess)
if (radio) radio.checked = true
const setCpu = (cpu) => { const r = document.getElementById("cpu-" + cpu); if (r) r.checked = true }
if (/aarch64|arm64|armv8/i.test(ua)) setCpu("arm64")
navigator.userAgentData?.getHighEntropyValues?.(["architecture"]).then((h) => { if (h.architecture === "arm") setCpu("arm64") }, () => {})

// The platform menu: a <details> of radios. Picking one closes it; Escape and clicks outside too.
const pick = document.querySelector(".pick")
if (pick) {
  const summary = pick.querySelector("summary")
  const close = (focus) => { pick.open = false; if (focus) summary.focus() }
  pick.addEventListener("toggle", () => { if (pick.open) pick.querySelector("input:checked")?.focus() })
  for (const label of pick.querySelectorAll("label")) label.addEventListener("click", (e) => { if (e.detail > 0) close(false) })
  for (const input of pick.querySelectorAll("input"))
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return
      e.preventDefault()
      input.checked = true
      close(true)
    })
  pick.addEventListener("keydown", (e) => { if (e.key === "Escape" && pick.open) { e.stopPropagation(); close(true) } })
  document.addEventListener("click", (e) => { if (pick.open && !pick.contains(e.target)) close(false) })
  pick.addEventListener("focusout", (e) => { if (pick.open && e.relatedTarget && !pick.contains(e.relatedTarget)) close(false) })
}

// Copy buttons. The install line's buttons turn into a check, and the rule under the command
// sweeps once.
const status = document.querySelector(".copy-status")
for (const b of document.querySelectorAll(".copy-line"))
  b.addEventListener("click", () => {
    navigator.clipboard.writeText(b.dataset.copy).then(() => {
      b.classList.add("copied")
      if (status) status.textContent = "Copied to clipboard"
      const cmds = b.closest(".cmds")
      if (cmds) { cmds.classList.remove("flash"); void cmds.offsetWidth; cmds.classList.add("flash") }
      clearTimeout(b.timer)
      b.timer = setTimeout(() => { b.classList.remove("copied"); if (status) status.textContent = "" }, 1600)
    }, () => {
      const code = b.parentElement.querySelector("code")
      if (code) getSelection().selectAllChildren(code)
    })
  })
document.querySelector(".cmds")?.addEventListener("animationend", (e) => e.currentTarget.classList.remove("flash"))
for (const pre of document.querySelectorAll("pre.term, pre.code")) {
  const b = document.createElement("button")
  b.type = "button"
  b.className = "copy"
  b.textContent = "Copy"
  b.dataset.copy = [...pre.querySelectorAll(".cmd")].map((c) => c.textContent).join("\n") || pre.querySelector("code").textContent
  pre.append(b)
}
for (const b of document.querySelectorAll("button[data-copy-from]")) b.dataset.copy = document.querySelector(b.dataset.copyFrom).textContent
for (const b of document.querySelectorAll("button[data-copy]:not(.copy-line)"))
  b.addEventListener("click", () => {
    navigator.clipboard.writeText(b.dataset.copy.trimEnd()).then(() => {
      b.textContent = "Copied"
      setTimeout(() => (b.textContent = "Copy"), 1500)
    })
  })

function reveal() {
  const el = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)))
  const d = el && (el.tagName === "DETAILS" ? el : el.closest("details"))
  if (d && !d.open) {
    d.open = true
    el.scrollIntoView()
  }
}
addEventListener("hashchange", reveal)
reveal()

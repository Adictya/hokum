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

// Which install to show first. Browsers rarely say the distribution; when they do, use it.
// `?platform=arch|debian|fedora|binary` overrides. ARM browsers on Linux say aarch64.
const ua = navigator.userAgent
const forced = new URLSearchParams(location.search).get("platform")
const guess = forced || (/Ubuntu|Debian|Mint|Pop!_OS/i.test(ua) ? "debian" : /Fedora|SUSE|Red Hat|CentOS/i.test(ua) ? "fedora" : "arch")
const radio = document.getElementById("p-" + guess)
if (radio) radio.checked = true
if (/aarch64|arm64/i.test(ua)) document.getElementById("cpu-arm64").checked = true

// Copy buttons.
for (const pre of document.querySelectorAll("pre.term, pre.code")) {
  const b = document.createElement("button")
  b.type = "button"
  b.className = "copy"
  b.textContent = "Copy"
  b.dataset.copy = [...pre.querySelectorAll(".cmd")].map((c) => c.textContent).join("\n") || pre.querySelector("code").textContent
  pre.append(b)
}
for (const b of document.querySelectorAll("button[data-copy-from]")) b.dataset.copy = document.querySelector(b.dataset.copyFrom).textContent
const status = document.getElementById("copy-status")
for (const b of document.querySelectorAll("button[data-copy]"))
  b.addEventListener("click", () => {
    const label = b.querySelector(".sp-label") || b
    const done = (state, text, announce) => {
      clearTimeout(b.reset)
      if (b.classList.contains("sp-copy")) b.dataset.state = state
      label.textContent = text
      if (status) status.textContent = announce
      b.reset = setTimeout(() => {
        delete b.dataset.state
        label.textContent = "Copy"
        if (status) status.textContent = ""
      }, 1800)
    }
    const copy = navigator.clipboard ? navigator.clipboard.writeText(b.dataset.copy.trimEnd()) : Promise.reject()
    copy.then(
      () => done("copied", "Copied", "Copied to clipboard"),
      () => {
        // No clipboard (insecure context, denied): select the text so Ctrl+C works.
        const code = b.parentElement.querySelector("code")
        if (code) getSelection().selectAllChildren(code)
        done("failed", "Ctrl+C", "Selected. Press Control C to copy")
      },
    )
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

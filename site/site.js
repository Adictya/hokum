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
// `?platform=arch|debian|fedora|binary` overrides.
const ua = navigator.userAgent
const forced = new URLSearchParams(location.search).get("platform")
const guess = forced || (/Ubuntu|Debian|Mint|Pop!_OS/i.test(ua) ? "debian" : /Fedora|SUSE|Red Hat|CentOS/i.test(ua) ? "fedora" : "arch")
const radio = document.getElementById("p-" + guess)
if (radio) radio.checked = true
// And which CPU: `?cpu=x64|arm64` overrides; Linux browsers on ARM say aarch64.
const cpu = new URLSearchParams(location.search).get("cpu") || (/aarch64|arm64|armv8/i.test(ua) ? "arm64" : "x64")
const pickCpu = (cpu) => { for (const r of document.querySelectorAll(`.cpu-pick[value="${cpu}"]`)) r.checked = true }
pickCpu(cpu)
navigator.userAgentData?.getHighEntropyValues?.(["architecture"]).then((v) => {
  if (!new URLSearchParams(location.search).has("cpu") && v.architecture === "arm") pickCpu("arm64")
}).catch(() => {})

// The install terminal's copy buttons: the icon turns into a tick and "Copied" shows beside it.
// Where the clipboard API is missing, the command is selected so it can be copied by hand.
const copyStatus = document.getElementById("copy-status")
for (const b of document.querySelectorAll(".tty-copy")) {
  b.hidden = false
  let timer
  b.addEventListener("click", () => {
    const done = (ok) => {
      clearTimeout(timer)
      b.classList.remove("done", "failed")
      void b.offsetWidth
      b.classList.add(ok ? "done" : "failed")
      copyStatus.textContent = ok ? "Copied to clipboard" : "Command selected"
      timer = setTimeout(() => {
        b.classList.remove("done", "failed")
        copyStatus.textContent = ""
      }, 1600)
    }
    const fallback = () => {
      const range = document.createRange()
      range.selectNodeContents(b.previousElementSibling)
      getSelection().removeAllRanges()
      getSelection().addRange(range)
      done(false)
    }
    if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.copy).then(() => done(true), fallback)
    else fallback()
  })
}

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
for (const b of document.querySelectorAll("button[data-copy]:not(.tty-copy)"))
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

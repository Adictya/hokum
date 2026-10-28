// The page below the hero: copy buttons, and links into a folded reference open it.
for (const pre of document.querySelectorAll("pre.term, pre.code")) {
  const b = document.createElement("button")
  b.type = "button"
  b.className = "copy"
  b.textContent = "Copy"
  const text = [...pre.querySelectorAll(".cmd")].map((c) => c.textContent).join("\n") || pre.querySelector("code").textContent
  b.addEventListener("click", () => copy(b, text.trimEnd()))
  pre.append(b)
}
for (const b of document.querySelectorAll("button[data-copy-from]"))
  b.addEventListener("click", () => copy(b, document.querySelector(b.dataset.copyFrom).textContent))
function copy(b, text) {
  navigator.clipboard.writeText(text).then(() => {
    b.textContent = "Copied"
    setTimeout(() => (b.textContent = "Copy"), 1500)
  })
}
function reveal() {
  const el = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)))
  const d = el && el.closest("details")
  if (d && !d.open) {
    d.open = true
    el.scrollIntoView()
  }
}
addEventListener("hashchange", reveal)
reveal()

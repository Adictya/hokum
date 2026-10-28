// The feature clips: small live desktops under the hero, drawn with the hero's card markup and
// icons (hero.js) and the same spring. No video, no screenshots.
;(() => {
  const icon = window.hokumIcon
  const reduce = matchMedia("(prefers-reduced-motion: reduce)")
  const K = (2 * Math.PI / 0.38) ** 2
  const C = (4 * Math.PI * (1 - 0.12)) / 0.38
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
  const tint = (app) => {
    let h = 2166136261
    for (const b of new TextEncoder().encode(app)) h = Math.imul(h ^ b, 16777619) >>> 0
    return `oklch(0.52 0.15 ${h % 360})`
  }

  function card(n) {
    const el = document.createElement("article")
    el.className = "card" + (n.urgency === 2 ? " critical" : "")
    el.style.setProperty("--tint", tint(n.app))
    el.innerHTML =
      `<div class="head"><span class="badge">${icon(n.app)}</span>` +
      `<span class="src">${esc(n.app)}${n.ctx ? " · " + esc(n.ctx) : ""}</span>` +
      `<span class="time">${esc(n.time || "now")}</span>` +
      `<span class="x" aria-hidden="true"><svg viewBox="0 0 10 10"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></span></div>` +
      `<div class="row"><div class="content"><div class="title">${esc(n.title)}</div>` +
      (n.body ? `<div class="body">${esc(n.body)}</div>` : "") +
      (n.progress != null ? `<div class="progress"><i></i></div>` : "") +
      `</div></div>` +
      (n.actions ? `<div class="actions">${n.actions.map((a) => `<button tabindex="-1">${esc(a)}</button>`).join("")}</div>` : "")
    if (n.progress != null) el.querySelector(".progress i").style.transform = `scaleX(${n.progress})`
    return el
  }

  // A stack in the top-right corner of a clip, on Hokum's spring.
  class Stack {
    constructor(host) {
      this.host = host
      this.el = document.createElement("div")
      this.el.className = "clip-stack"
      host.append(this.el)
      this.cards = []
      this.max = 4
    }
    add(n, at = 0) {
      const el = card(n)
      this.el.append(el)
      const c = { n, el, x: 40, y: 0, o: 0, vx: 0, vy: 0, vo: 0, tx: 0, ty: 0, to: 1, leaving: false }
      this.cards.splice(at, 0, c)
      this.layout()
      c.y = c.ty
      if (reduce.matches) Object.assign(c, { x: 0, o: 1 })
      const shown = this.cards.filter((k) => !k.leaving)
      for (const old of shown.slice(this.max)) this.leave(old, 0)
      return c
    }
    leave(c, dir = 1) {
      if (!c || c.leaving) return
      c.leaving = true
      c.tx = dir * 420
      c.to = 0
      this.layout()
    }
    replace(c, n) {
      const el = card(n)
      c.el.replaceWith(el)
      c.el = el
      c.n = n
    }
    clear() {
      for (const c of this.cards) c.el.remove()
      this.cards = []
    }
    layout() {
      let y = 0
      for (const c of this.cards) {
        if (c.leaving) continue
        c.ty = y
        y += c.el.offsetHeight + 10
      }
    }
    step(dt) {
      for (const c of this.cards.slice()) {
        if (reduce.matches) Object.assign(c, { x: c.tx, y: c.ty, o: c.to })
        else for (const [p, v, t] of [["x", "vx", "tx"], ["y", "vy", "ty"], ["o", "vo", "to"]]) {
          c[v] += (K * (c[t] - c[p]) - C * c[v]) * dt
          c[p] += c[v] * dt
        }
        if (c.leaving && (c.o < 0.02 || reduce.matches)) {
          c.el.remove()
          this.cards = this.cards.filter((k) => k !== c)
          this.layout()
          continue
        }
        c.el.style.transform = `translate3d(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px, 0)`
        c.el.style.opacity = Math.max(0, Math.min(1, c.o)).toFixed(3)
      }
    }
  }

  // Each clip is a script of steps: [seconds to wait, what to do]. It loops while on screen.
  const SLACK = { app: "Slack", ctx: "#design", title: "Dax", body: "the new theme is sick 🔥", actions: ["Reply", "Later"], time: "9:41 AM" }
  const VOLUME = { app: "Volume", title: "Speakers", progress: 0.62, time: "9:41 AM" }
  const clips = {
    themes(s, host) {
      const label = host.querySelector(".clip-label")
      const ids = ["capsule", "soft", "crisp", "ribbon", "terminal", "bubble", "signal", "pill"]
      let i = 0
      const show = () => {
        host.dataset.theme = ids[i]
        label.textContent = `theme "${ids[i]}"`
        s.layout()
      }
      return [
        [0.2, () => { s.clear(); i = 0; show(); s.add(VOLUME); s.add(SLACK) }],
        ...ids.slice(1).map(() => [1.7, () => { i++; show() }]),
        [1.7, () => {}],
      ]
    },
    stack(s) {
      const notes = [
        { app: "Firefox", title: "Download complete", body: "hokum-x86_64.tar.zst · 4.2 MB" },
        { app: "Calendar", title: "Standup", body: "in 5 min · Room 3" },
        { app: "Messages", title: "Mom", body: "are you eating" },
        { app: "GitHub", title: "Review requested", body: "anomalyco/hokum #412" },
        { app: "Spotify", title: "Kiasmos", body: "Blurred · Blurred EP" },
      ]
      return [
        [0.3, () => s.clear()],
        ...notes.map((n) => [1.1, () => s.add({ ...n, time: "now" })]),
        [1.4, () => s.leave(s.cards.filter((c) => !c.leaving)[1])],
        [1.4, () => s.leave(s.cards.filter((c) => !c.leaving)[0], -1)],
        [1.8, () => s.cards.forEach((c, i) => setTimeout(() => s.leave(c), i * 90))],
        [1.2, () => {}],
      ]
    },
    actions(s, host) {
      let vol
      const steps = [[0.3, () => { s.clear(); vol = s.add({ ...VOLUME, progress: 0.3 }) }]]
      for (let v = 0.36; v <= 0.84; v += 0.06) steps.push([0.16, () => s.replace(vol, { ...VOLUME, progress: v })])
      steps.push(
        [0.9, () => s.add({ app: "Calendar", title: "Design review", body: "in 5 min · Room 3", actions: ["Join", "Snooze"], time: "9:55 AM" })],
        [1.6, () => host.querySelector(".actions button:last-child")?.classList.add("pressed")],
        [0.35, () => s.leave(s.cards.find((c) => c.n.app === "Calendar" && !c.leaving))],
        [0.5, () => s.add({ app: "Calendar", title: "Snoozed: Design review", body: "We'll remind you in 10 minutes", time: "9:55 AM" })],
        [2.2, () => s.cards.forEach((c, i) => setTimeout(() => s.leave(c), i * 90))],
        [1.0, () => {}],
      )
      return steps
    },
    dnd(s, host) {
      const sw = host.querySelector(".clip-dnd")
      const held = host.querySelector(".clip-held")
      const set = (on, n = 0) => {
        sw.classList.toggle("on", on)
        held.textContent = n ? `${n} waiting` : ""
      }
      return [
        [0.3, () => { s.clear(); set(false) }],
        [0.5, () => s.add({ app: "Slack", ctx: "#random", title: "Jay", body: "lunch?", time: "12:01 PM" })],
        [1.6, () => { set(true); s.cards.forEach((c) => s.leave(c)) }],
        [1.2, () => set(true, 1)],
        [0.9, () => set(true, 2)],
        [0.9, () => set(true, 3)],
        [1.0, () => s.add({ app: "Battery", urgency: 2, title: "Battery critically low", body: "4% remaining. Plug in now.", time: "12:04 PM" })],
        [2.4, () => { set(false); s.cards.forEach((c) => s.leave(c)) }],
        [1.0, () => {}],
      ]
    },
  }

  for (const host of document.querySelectorAll("[data-clip]")) {
    const screen = host.querySelector(".clip-screen")
    const s = new Stack(screen)
    const steps = clips[host.dataset.clip](s, screen)
    let i = 0, wait = 0.6, visible = false, last = 0
    new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: "100px" }).observe(host)
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000 || 0)
      last = now
      if (visible) {
        wait -= dt
        while (wait <= 0) {
          steps[i][1]()
          i = (i + 1) % steps.length
          wait += steps[i][0]
        }
        s.step(dt)
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }
})()

// The Anomaly team argues about this landing page, live, as Hokum notifications.
// Cards stack in the top-right with Hokum's spring (response 0.38s, bounce 0.12), can be dragged,
// flung and dismissed at any point, and the script carries on regardless.
;(() => {
  const $ = (s) => document.querySelector(s)
  const layer = $("#cards")
  const install = $("#install")
  const pillEl = $("#pill")
  const pillN = $("#pill-n")
  const skipBtn = $("#skip")
  const replayBtn = $("#replay")
  const clockEl = $("#clock")
  const panel = $("#panel")

  const motion = matchMedia("(prefers-reduced-motion: reduce)")
  let still = motion.matches
  motion.addEventListener("change", (e) => (still = e.matches))

  const TAU = Math.PI * 2
  const spring = (response, bounce) => ({ k: (TAU / response) ** 2, c: (4 * Math.PI * (1 - bounce)) / response })
  const CARD = spring(0.38, 0.12)
  const SNAP = spring(0.5, 0.3)
  const MAX_SHOWN = 5
  const SPACING = 12

  // Tuning for the fight.
  const F = {
    pull: 34, // toward the corner
    damp: 5,
    push: 5200, // between overlapping cards
    bullyPull: 95,
    bullyDamp: 8,
    charge: 1500, // px/s running at it
    lean: 430, // px/s while pushing the command
    leanFor: 800, // ms of pushing before the last shove
    jostleEvery: [160, 340],
  }

  // -------------------------------------------------------------------------------------------
  // Script. Times are ms on the page's own clock, which pauses while the tab is hidden.

  const SLACK = (who, text, extra = {}) => ({ who, text, badge: "slack", ctx: "#landing-page", ...extra })
  const ideas = [
    "1. Do Not Disturb, but it’s sarcastic",
    "2. a notification that runs away from your cursor",
    "3. notifications through the ages (2004 → now)",
    "4. a theme catwalk",
    "5. ask your agent for a theme, but cursed",
  ]
  const BRAWL = 21300
  const script = [
    [1800, () => say(SLACK("Kit", "hex has a guy screaming. what’s our joke", { actions: ["Reply", "Later"] }))],
    [4600, () => say(SLACK("Dax", "notifications aren’t funny"))],
    [7000, () => say(SLACK("Kit", "what if you could drag them"))],
    [9300, () => say(SLACK("Dax", "that’s not a joke that’s a feature"))],
    [12000, () => say(SLACK("Kit", "ok here are five ideas"))],
    [13100, () => say(SLACK("Kit", ideas[0], { idea: 1 }))],
    [13450, () => say(SLACK("Kit", ideas[1], { idea: 2, evade: true }))],
    [13750, () => say(SLACK("Kit", ideas[2], { idea: 3 }))],
    [14000, () => say(SLACK("Kit", ideas[3], { idea: 4 }))],
    [14220, () => say(SLACK("Kit", ideas[4], { idea: 5 }))],
    [18000, () => say(SLACK("Dax", "these all suck"))],
    [19500, () => say(SLACK("Dax", "none of these are funny right"))],
    [BRAWL, brawl],
    [BRAWL + 1700, nudge],
    [BRAWL + 3000, surge],
    [BRAWL + 5600, () => say(SLACK("Dax", "just ship the install command", { critical: true }))],
    [BRAWL + 5650, freeze],
    [BRAWL + 7000, clearAll],
    [BRAWL + 7600, comeBack],
    [BRAWL + 8300, done],
    [BRAWL + 22000, () => say(SLACK("Kit", "ok but what if it was a whole life in notifications", { stay: 4200 }))],
  ]

  // -------------------------------------------------------------------------------------------
  // Geometry.

  let W = 0, H = 0, G = 18, CW = 420, TOP = 46
  function measure() {
    W = innerWidth
    H = innerHeight
    G = W < 600 ? 10 : 18
    CW = Math.min(W >= 1280 ? 440 : 420, W - G * 2)
    TOP = panel.offsetHeight + G
  }

  // The install command as a body: its resting rect plus an offset, a tilt, and its own mode.
  const inst = { hx: 0, hy: 0, w: 0, h: 0, x: 0, y: 0, vx: 0, vy: 0, r: 0, vr: 0, o: 1, mode: "home", spring: CARD }
  function homeInstall() {
    const t = install.style.transform
    install.style.transform = "none"
    const b = install.getBoundingClientRect()
    install.style.transform = t
    inst.hx = b.left
    inst.hy = b.top
    inst.w = b.width
    inst.h = b.height
  }
  const instRect = () => ({ x: inst.hx + inst.x, y: inst.hy + inst.y, w: inst.w, h: inst.h })
  const instGone = () => {
    const r = instRect()
    // Generous, since it's tilted by then.
    const m = 120
    return r.x + r.w < -m || r.x > W + m || r.y > H + m || r.y + r.h < -m
  }

  // -------------------------------------------------------------------------------------------
  // Cards.

  const SLACK_ICON = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="#fff"/>${[
    ["#36C5F0", 0],
    ["#2EB67D", 90],
    ["#ECB22E", 180],
    ["#E01E5A", 270],
  ]
    .map(
      ([c, a]) =>
        `<g transform="rotate(${a} 10 10)" fill="${c}"><rect x="4.1" y="7.1" width="5.9" height="2.3" rx="1.15"/><rect x="7.7" y="4.1" width="2.3" height="2.4" rx="1.15"/></g>`,
    )
    .join("")}</svg>`
  const WARN_ICON = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="var(--danger)"/><path d="M10 5.4 14.7 13.8H5.3Z" fill="none" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/><path d="M10 8.9v2.2" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/><circle cx="10" cy="12.6" r=".75" fill="#fff"/></svg>`
  const X_ICON = `<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7m0-7-7 7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  const clock = () => {
    const d = new Date()
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }
  // Hokum's per-app tint: FNV-1a of the name, as a hue.
  const tint = (app) => {
    let h = 2166136261
    for (const ch of app) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
    return `oklch(0.64 0.13 ${h % 360})`
  }

  let cards = []
  let seq = 0
  let zTop = 10
  const rand = (a, b) => a + Math.random() * (b - a)

  function say(n) {
    const el = document.createElement("div")
    el.className = "card" + (n.critical ? " critical" : "")
    el.setAttribute("role", n.critical ? "alert" : "status")
    const app = n.app ?? "Slack"
    const badge = n.critical
      ? WARN_ICON
      : n.badge === "slack"
        ? SLACK_ICON
        : `<span class="badge" style="background:${tint(app)}">${app[0]}</span>`
    el.innerHTML =
      `<div class="head">${n.badge === "slack" || n.critical ? `<span class="badge">${badge}</span>` : badge}` +
      `<span class="src">${esc(app)}${n.ctx ? ` · ${esc(n.ctx)}` : ""}</span><span class="time">${clock()}</span>` +
      `<button type="button" class="x" aria-label="Dismiss">${X_ICON}</button></div>` +
      `<div class="msg"><div class="title">${esc(n.who)}</div>${n.text ? `<div class="body">${esc(n.text)}</div>` : ""}</div>` +
      (n.actions ? `<div class="actions">${n.actions.map((a, i) => `<button type="button"${i ? "" : ' class="primary"'}>${a}</button>`).join("")}</div>` : "")
    el.style.width = CW + "px"
    layer.appendChild(el)
    const c = {
      el, n, id: ++seq, w: CW, h: el.offsetHeight,
      x: 0, y: 0, vx: 0, vy: 0, r: 0, vr: 0, rr: 0, s: 0.97, vs: 0, o: 0,
      tx: 0, ty: 0, ts: 1, to: 1, ex: 0, ey: 0,
      mode: "stack", home: "stack", z: ++zTop, born: clockMs, stay: n.stay, last: "",
    }
    cards.push(c)
    el._card = c
    layout()
    c.x = still ? c.tx : c.tx + 48
    c.y = c.ty
    if (still) c.s = 1
    return c
  }

  function remove(c) {
    c.el.remove()
    cards = cards.filter((d) => d !== c)
    layout()
  }

  // The real exit: slide out past the trailing edge and fade.
  function dismiss(c) {
    if (c.mode === "exit" || c.mode === "fly") return
    c.mode = "exit"
    c.el.classList.add("ghost")
    layout()
  }

  function fling(c, vx, vy) {
    c.mode = "fly"
    c.vx = vx
    c.vy = vy
    c.vr = vx * 0.03 + rand(-40, 40)
    c.el.classList.add("ghost")
    layout()
  }

  // Slots, newest first, under the panel. Past five the rest wait behind the last one.
  const slotted = () =>
    cards.filter((c) => c.mode === "stack" || (c.mode === "drag" && c.home === "stack")).sort((a, b) => b.id - a.id)
  const pill = { x: 0, y: 0, vx: 0, vy: 0, o: 0, to: 0, shown: false, last: "" }
  function layout() {
    let y = TOP
    let lastBottom = TOP
    const list = slotted()
    list.forEach((c, i) => {
      c.tx = W - G - c.w
      if (i < MAX_SHOWN) {
        c.ty = y
        c.ts = 1
        c.to = 1
        y += c.h + SPACING
        lastBottom = y
      } else {
        const last = list[MAX_SHOWN - 1]
        c.ty = last.ty + last.h - c.h
        c.ts = 0.94
        c.to = 0
      }
      c.el.classList.toggle("ghost", i >= MAX_SHOWN)
    })
    const hidden = Math.max(0, list.length - MAX_SHOWN)
    pill.to = hidden > 0 && phase !== "brawl" ? 1 : 0
    if (hidden > 0) pillN.textContent = `${hidden} more`
    pillEl.hidden = false
    pill.w = pillEl.offsetWidth
    const tx = W - G - pill.w
    if (!pill.shown && pill.to) {
      pill.x = tx
      pill.y = lastBottom
    }
    pill.shown = !!pill.to
    pill.tx = tx
    pill.ty = lastBottom
    pillEl.style.pointerEvents = pill.to ? "auto" : "none"
  }

  // -------------------------------------------------------------------------------------------
  // The fight.

  let phase = "quiet"
  let nextJostle = 0
  let bullies = []
  let target = null // where the bullies drive the install command

  function brawl() {
    phase = "brawl"
    for (const c of cards) {
      if (c.mode === "stack") c.mode = "brawl"
      else if (c.mode === "drag") c.home = "brawl"
      c.to = 1
      c.ts = 1
      c.rr = rand(-3, 3)
      c.el.classList.remove("ghost")
    }
    inst.mode = "loose"
    layout()
    if (still) scatter()
  }

  // With reduced motion the fight is a still: a heap of cards over where the command was.
  function scatter() {
    const list = cards.filter((c) => c.mode === "brawl").sort((a, b) => a.id - b.id)
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[list[i], list[j]] = [list[j], list[i]]
    }
    list.forEach((c, i) => {
      const f = list.length > 1 ? i / (list.length - 1) : 0
      const reach = Math.max(0, W / 2 - c.w / 2 - G)
      c.x = Math.min(W - G - c.w, W - G - c.w - Math.sqrt(f) * reach * rand(0.6, 1.1) + rand(-40, 40))
      c.y = TOP + f * Math.max(0, H / 2 - TOP) * rand(0.5, 1.1) + rand(-10, 30)
      c.r = rand(-6, 6)
      c.z = ++zTop
    })
  }

  const bodiesFighting = () => cards.filter((c) => c.mode === "brawl" || c.mode === "bully")

  // One card gets knocked out of the pile and into the command. It skids. Nobody notices.
  function nudge() {
    if (still) return
    const pick = cards.find((c) => c.n.idea === 4 && c.mode === "brawl") ?? bodiesFighting().at(-1)
    if (!pick) return
    pick.mode = "bully"
    pick.nudge = true
    pick.until = clockMs + 900
    pick.z = ++zTop
    target = null
  }

  // Then they all go for it.
  function surge() {
    if (still) {
      inst.mode = "gone"
      return
    }
    const fighting = bodiesFighting()
    // The ones nearest the command lead, plus whoever's on top.
    const r = instRect()
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    fighting.sort((a, b) => Math.hypot(a.x + a.w / 2 - cx, a.y + a.h / 2 - cy) - Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy))
    bullies = fighting.slice(0, Math.min(4, fighting.length))
    for (const c of bullies) {
      c.mode = "bully"
      c.until = clockMs + 2200
      c.z = ++zTop
    }
    // Away from the corner, through the command and off the page.
    const fx = W
    const fy = TOP
    let dx = cx - fx
    let dy = cy - fy
    const len = Math.hypot(dx, dy) || 1
    target = { dx: dx / len, dy: dy / len, at: clockMs }
    inst.mode = "shoved"
  }

  // The critical card lands in the corner, the pile flinches out of its way and goes quiet.
  function freeze() {
    phase = "freeze"
    for (const c of cards) {
      if (c.mode === "bully") c.mode = "brawl"
      if (c.mode !== "brawl" || still) continue
      c.vx -= rand(250, 650)
      c.vy += rand(60, 360)
      c.vr += rand(-40, 40)
    }
  }

  function clearAll() {
    phase = "clear"
    const list = cards.filter((c) => c.mode !== "exit" && c.mode !== "fly").sort((a, b) => a.z - b.z)
    const crit = list.find((c) => c.n.critical)
    const rest = list.filter((c) => c !== crit)
    rest.forEach((c, i) => setTimeout(() => (still ? dismiss(c) : fling(c, rand(2200, 3000), rand(-500, 300))), i * 45))
    if (crit) setTimeout(() => dismiss(crit), rest.length * 45 + 260)
  }

  function comeBack() {
    inst.mode = "return"
    install.classList.add("final")
    // Re-measure at the bigger size, keeping where it is on screen now.
    const r = instRect()
    homeInstall()
    inst.x = r.x + r.w / 2 - (inst.hx + inst.w / 2)
    inst.y = r.y + r.h / 2 - (inst.hy + inst.h / 2)
    if (still || !isFinite(inst.x)) {
      inst.x = inst.y = inst.r = 0
    } else {
      // From wherever it went, but not from so far away that the trip outlasts the joke.
      const d = Math.hypot(inst.x, inst.y)
      const max = Math.max(W, H) * 0.75
      if (d > max) {
        inst.x *= max / d
        inst.y *= max / d
      }
      inst.vx = inst.vy = 0
    }
    inst.spring = SNAP
  }

  function done() {
    phase = "done"
    skipBtn.hidden = true
    replayBtn.hidden = false
  }

  // -------------------------------------------------------------------------------------------
  // Physics.

  let pointer = { x: -1e4, y: -1e4, mouse: false }
  let drag = null

  function springTo(b, x, y, sp, dt) {
    b.vx += (sp.k * (x - b.x) - sp.c * b.vx) * dt
    b.vy += (sp.k * (y - b.y) - sp.c * b.vy) * dt
    b.x += b.vx * dt
    b.y += b.vy * dt
  }
  function springScalar(b, key, vkey, to, sp, dt) {
    b[vkey] += (sp.k * (to - b[key]) - sp.c * b[vkey]) * dt
    b[key] += b[vkey] * dt
  }

  // The card that runs away from your cursor.
  function evade(c, dt) {
    if (!c.n.evade || !pointer.mouse || drag?.c === c || still) {
      c.ex *= Math.exp(-2 * dt)
      c.ey *= Math.exp(-2 * dt)
      return
    }
    const m = 36
    const x = c.x, y = c.y
    if (pointer.x > x - m && pointer.x < x + c.w + m && pointer.y > y - m && pointer.y < y + c.h + m) {
      let dx = x + c.w / 2 - pointer.x
      let dy = (y + c.h / 2 - pointer.y) * 2.5
      const len = Math.hypot(dx, dy) || 1
      c.ex += (dx / len) * 1600 * dt
      c.ey += (dy / len) * 1600 * dt
      c.ex = Math.max(-c.tx + 4, Math.min(W - c.w - 4 - c.tx, c.ex))
      c.ey = Math.max(TOP - c.ty, Math.min(H - c.h - 4 - c.ty, c.ey))
    } else {
      c.ex *= Math.exp(-0.6 * dt)
      c.ey *= Math.exp(-0.6 * dt)
    }
  }

  function step(dt) {
    const fighting = phase === "brawl" || phase === "freeze"
    for (const c of cards) {
      evade(c, dt)
      switch (c.mode) {
        case "stack": {
          if (still) {
            c.x = c.tx + c.ex
            c.y = c.ty + c.ey
            c.s = c.ts
            c.r = 0
          } else {
            springTo(c, c.tx + c.ex, c.ty + c.ey, CARD, dt)
            springScalar(c, "s", "vs", c.ts, CARD, dt)
            springScalar(c, "r", "vr", 0, CARD, dt)
          }
          break
        }
        case "brawl":
        case "bully": {
          if (still) break
          let px = W - G - c.w + c.ex
          let py = TOP + c.ey
          let k = F.pull
          let damp = F.damp
          if (c.mode === "bully") {
            const r = instRect()
            const dx = target ? target.dx : r.x + r.w / 2 - (c.x + c.w / 2)
            const dy = target ? target.dy : r.y + r.h / 2 - (c.y + c.h / 2)
            const len = Math.hypot(dx, dy) || 1
            // Aim past the far side of the command, so they push through it.
            px = r.x + r.w / 2 + (dx / len) * 260 - c.w / 2
            py = r.y + r.h / 2 + (dy / len) * 260 - c.h / 2
            k = F.bullyPull
            damp = F.bullyDamp
            if (clockMs > c.until || inst.mode === "gone" || phase === "freeze") c.mode = "brawl"
          }
          if (phase === "freeze") {
            k = 0
            damp = 7
          }
          c.vx += (k * (px - c.x) - damp * c.vx) * dt
          c.vy += (k * (py - c.y) - damp * c.vy) * dt
          // Once they're on it, they lean on it: a slow, deliberate push.
          if (c.mode === "bully") {
            const cap = target && clockMs - (c.touch ?? -1e9) < 120 ? F.lean : F.charge
            const sp = Math.hypot(c.vx, c.vy)
            if (sp > cap) {
              c.vx *= cap / sp
              c.vy *= cap / sp
            }
          }
          c.x += c.vx * dt
          c.y += c.vy * dt
          // The corner has walls.
          if (c.mode === "brawl") {
            if (c.x + c.w > W - 4) { c.x = W - 4 - c.w; c.vx = Math.min(0, c.vx) * -0.3 }
            if (c.y < TOP - 6) { c.y = TOP - 6; c.vy = Math.max(0, c.vy) * -0.3 }
          }
          springScalar(c, "r", "vr", phase === "freeze" ? c.rr * 0.5 : c.rr, spring(0.3, 0.3), dt)
          springScalar(c, "s", "vs", 1, CARD, dt)
          break
        }
        case "drag": {
          springScalar(c, "r", "vr", still ? 0 : Math.max(-8, Math.min(8, (drag?.vx ?? 0) * 0.006)), CARD, dt)
          springScalar(c, "s", "vs", still ? 1 : 1.02, CARD, dt)
          break
        }
        case "fly": {
          c.x += c.vx * dt
          c.y += c.vy * dt
          c.r += c.vr * dt
          if (still) c.o -= dt * 6
          if (c.x > W + 80 || c.x + c.w < -80 || c.y > H + 80 || c.y + c.h < -80 || c.o <= 0) c.dead = true
          break
        }
        case "exit": {
          if (still) c.x = c.tx
          else springTo(c, W + 24, c.y, CARD, dt)
          c.o -= dt * 5
          if (c.o <= 0) c.dead = true
          break
        }
      }
      if (c.mode !== "fly" && c.mode !== "exit") {
        const to = c.to
        c.o += Math.sign(to - c.o) * Math.min(Math.abs(to - c.o), dt * 7)
      }
      if (c.stay && clockMs - c.born > c.stay && c.mode === "stack") dismiss(c)
    }

    // Shoving: overlapping fighters push apart from their centres, softly, so they overlap.
    if (fighting && !still) {
      const list = cards.filter((c) => c.mode === "brawl" || c.mode === "bully" || (c.mode === "drag" && c.home === "brawl"))
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j]
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
          const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
          if (ox <= 0 || oy <= 0) continue
          const area = (ox * oy) / Math.min(a.w * a.h, b.w * b.h)
          let dx = b.x + b.w / 2 - (a.x + a.w / 2)
          let dy = (b.y + b.h / 2 - (a.y + a.h / 2)) * 2
          let len = Math.hypot(dx, dy)
          if (len < 1) { dx = rand(-1, 1); dy = rand(-1, 1); len = Math.hypot(dx, dy) }
          const f = F.push * area * dt
          const am = a.mode === "drag" ? 0 : a.mode === "bully" ? 0.3 : 1
          const bm = b.mode === "drag" ? 0 : b.mode === "bully" ? 0.3 : 1
          a.vx -= (dx / len) * f * am
          a.vy -= (dy / len) * f * am
          b.vx += (dx / len) * f * bm
          b.vy += (dy / len) * f * bm
        }
      }
    }

    // The install command: a heavier body. Before the fight it springs home when bumped.
    if (!still) {
      const hitters = cards.filter(
        (c) => c.o > 0.5 && (c.mode === "brawl" || c.mode === "bully" || c.mode === "drag"),
      )
      // Once the surge starts only the bullies touch it, and after the last shove nothing does.
      // The pile passes over it (notifications float over the page); the nudge and your drags don't.
      if (inst.mode === "home" || inst.mode === "loose") {
        for (const c of hitters) if (c.mode !== "brawl") collide(c)
      } else if (inst.mode === "shoved" && !target?.kicked) {
        for (const c of hitters) if (c.mode === "bully") collide(c)
      }
      switch (inst.mode) {
        case "home":
        case "return":
          springTo(inst, 0, 0, inst.spring, dt)
          springScalar(inst, "r", "vr", 0, inst.spring, dt)
          break
        case "loose":
        case "shoved": {
          const fr = inst.mode === "loose" ? 3.2 : 1.1
          inst.vx *= Math.exp(-fr * dt)
          inst.vy *= Math.exp(-fr * dt)
          inst.vr *= Math.exp(-2.5 * dt)
          // It doesn't leave the page on its own before the surge.
          if (inst.mode === "loose") {
            const r = instRect()
            if (r.x < 8) { inst.x += 8 - r.x; inst.vx = Math.abs(inst.vx) * 0.3 }
            if (r.y + r.h > H - 8) { inst.y -= r.y + r.h - (H - 8); inst.vy = -Math.abs(inst.vy) * 0.3 }
          }
          // If the bullies can't finish it, the last one kicks.
          // After a moment of leaning on it, the last shove.
          if (
            inst.mode === "shoved" && target && !target.kicked &&
            ((target.contact && clockMs - target.contact > F.leanFor) || clockMs - target.at > 2000)
          ) {
            target.kicked = true
            const sp = inst.vx * target.dx + inst.vy * target.dy
            const v = Math.max(sp, 2100)
            inst.vx = target.dx * v
            inst.vy = target.dy * v
            inst.vr += target.dx < 0 ? -140 : 140
            for (const c of bullies) c.until = clockMs + 120
          }
          // Knocked about, not spun: it keeps within a tilt until it's sent off.
          if (inst.mode === "loose" || !target?.kicked) {
            const lim = 9
            if (Math.abs(inst.r) > lim) {
              inst.r = Math.sign(inst.r) * lim
              inst.vr *= -0.3
            }
          }
          if (inst.mode === "shoved" && !target?.kicked) {
            const sp = Math.hypot(inst.vx, inst.vy)
            const cap = F.lean * 1.15
            if (sp > cap) {
              inst.vx *= cap / sp
              inst.vy *= cap / sp
            }
          }
          inst.x += inst.vx * dt
          inst.y += inst.vy * dt
          inst.r += inst.vr * dt
          if (inst.mode === "shoved" && instGone()) inst.mode = "gone"
          break
        }
      }
    }
    if (still) {
      if (inst.mode === "gone") inst.o = Math.max(0, inst.o - dt * 5)
      else inst.o = Math.min(1, inst.o + dt * 5)
      if (inst.mode === "return" || inst.mode === "home") inst.x = inst.y = inst.r = 0
    } else inst.o = 1

    if (pill.shown || pill.o > 0) {
      if (still) { pill.x = pill.tx; pill.y = pill.ty }
      else springTo(pill, pill.tx, pill.ty, CARD, dt)
      pill.o += Math.sign(pill.to - pill.o) * Math.min(Math.abs(pill.to - pill.o), dt * 7)
    }
  }

  // A card against the command: resolve along the shallower axis, trade momentum, add a twist.
  function collide(c) {
    const r = instRect()
    const ox = Math.min(c.x + c.w, r.x + r.w) - Math.max(c.x, r.x)
    const oy = Math.min(c.y + c.h, r.y + r.h) - Math.max(c.y, r.y)
    if (ox <= 0 || oy <= 0) return
    const mc = c.mode === "drag" ? 1e6 : c.mode === "bully" ? 2 : 1
    // Heavy until the surge: the pile bumps it, only the nudge moves it.
    const mi = inst.mode === "home" ? 2.5 : inst.mode === "shoved" ? 1.6 : c.nudge ? 8 : 14
    const share = mc / (mc + mi)
    const icx = r.x + r.w / 2, icy = r.y + r.h / 2
    const ccx = c.x + c.w / 2, ccy = c.y + c.h / 2
    let nx = 0, ny = 0
    if (ox / r.w < oy / r.h) {
      nx = ccx < icx ? 1 : -1
      inst.x += nx * ox * share
      c.x -= nx * ox * (1 - share)
    } else {
      ny = ccy < icy ? 1 : -1
      inst.y += ny * oy * share
      c.y -= ny * oy * (1 - share)
    }
    if (c.mode === "bully" && inst.mode === "shoved" && target) {
      c.touch = clockMs
      target.contact ??= clockMs
    }
    const rel = (c.vx - inst.vx) * nx + (c.vy - inst.vy) * ny
    if (rel > 0) {
      const j = (rel * (inst.mode === "shoved" ? 1 : 1.2)) / (1 / mc + 1 / mi)
      c.vx -= (j * nx) / mc
      c.vy -= (j * ny) / mc
      inst.vx += (j * nx) / mi
      inst.vy += (j * ny) / mi
      // Off-centre hits spin it.
      const lever = nx ? (ccy - icy) / r.h : -(ccx - icx) / r.w
      inst.vr += Math.max(-90, Math.min(90, (j / mi) * lever * 0.12 * (nx || ny)))
    }
    // The nudge is one knock, then back to the pile.
    if (c.nudge) {
      c.nudge = false
      c.mode = "brawl"
    }
  }

  function jostle() {
    if (phase !== "brawl" || still) return
    if (clockMs < nextJostle) return
    nextJostle = clockMs + rand(...F.jostleEvery)
    const list = cards.filter((c) => c.mode === "brawl")
    if (!list.length) return
    // Whoever's furthest from the corner wants it most.
    list.sort((a, b) => b.y - a.y + (W - b.x - b.w - (W - a.x - a.w)))
    const c = Math.random() < 0.6 ? list[Math.floor(rand(0, Math.min(3, list.length)))] : list[Math.floor(rand(0, list.length))]
    c.z = ++zTop
    c.vx += rand(250, 900)
    c.vy -= rand(150, 800)
    c.vr += rand(-160, 160)
    c.rr = rand(-4.5, 4.5)
  }

  // -------------------------------------------------------------------------------------------
  // Drawing.

  function render() {
    for (const c of cards) {
      const t = `translate3d(${c.x.toFixed(2)}px,${c.y.toFixed(2)}px,0) rotate(${c.r.toFixed(2)}deg) scale(${c.s.toFixed(4)})|${Math.max(0, c.o).toFixed(3)}|${c.z}`
      if (t === c.last) continue
      c.last = t
      const [tf, o, z] = t.split("|")
      c.el.style.transform = tf
      c.el.style.opacity = o
      c.el.style.zIndex = z
    }
    const it = `translate3d(${inst.x.toFixed(2)}px,${inst.y.toFixed(2)}px,0) rotate(${inst.r.toFixed(2)}deg)|${inst.o.toFixed(3)}`
    if (it !== inst.last) {
      inst.last = it
      const [tf, o] = it.split("|")
      install.style.transform = tf
      install.style.opacity = o
      install.style.visibility = inst.o <= 0 ? "hidden" : ""
    }
    const pt = `translate3d(${pill.x.toFixed(2)}px,${pill.y.toFixed(2)}px,0)|${Math.max(0, pill.o).toFixed(3)}`
    if (pt !== pill.last) {
      pill.last = pt
      const [tf, o] = pt.split("|")
      pillEl.style.transform = tf
      pillEl.style.opacity = o
    }
  }

  // -------------------------------------------------------------------------------------------
  // Clock and loop.

  let clockMs = 0
  let si = 0
  let running = false
  let lastFrame = 0

  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000))
    lastFrame = now
    if (running) {
      clockMs += dt * 1000
      while (si < script.length && clockMs >= script[si][0]) script[si++][1]()
    }
    jostle()
    const n = Math.max(1, Math.ceil(dt / (1 / 240)))
    for (let i = 0; i < n; i++) step(dt / n)
    if (cards.some((c) => c.dead)) {
      cards.filter((c) => c.dead).forEach((c) => c.el.remove())
      cards = cards.filter((c) => !c.dead)
      layout()
    }
    render()
    requestAnimationFrame(frame)
  }

  function reset() {
    for (const c of cards) c.el.remove()
    cards = []
    phase = "quiet"
    bullies = []
    target = null
    install.classList.remove("final")
    homeInstall()
    Object.assign(inst, { x: 0, y: 0, vx: 0, vy: 0, r: 0, vr: 0, o: 1, mode: "home", spring: CARD })
    pill.o = pill.to = 0
    pill.shown = false
    layout()
  }

  function start() {
    reset()
    clockMs = 0
    si = 0
    running = true
    skipBtn.hidden = false
    replayBtn.hidden = true
  }

  function skip() {
    running = false
    reset()
    install.classList.add("final")
    homeInstall()
    phase = "done"
    skipBtn.hidden = true
    replayBtn.hidden = false
  }

  // -------------------------------------------------------------------------------------------
  // Input: drag, fling, dismiss.

  layer.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".card")
    if (!el || e.button > 0) return
    const c = el._card
    if (!c || c.o < 0.4 || c.mode === "exit" || c.mode === "fly") return
    if (e.target.closest("button")) return
    e.preventDefault()
    el.setPointerCapture(e.pointerId)
    drag = { c, id: e.pointerId, ox: e.clientX - c.x, oy: e.clientY - c.y, sx: e.clientX, sy: e.clientY, moved: false, samples: [], vx: 0 }
    c.home = c.mode === "brawl" || c.mode === "bully" ? "brawl" : "stack"
    c.mode = "drag"
    c.vx = c.vy = 0
    c.z = ++zTop
    el.classList.add("drag")
  })
  layer.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const c = drag.c
    c.x = e.clientX - drag.ox
    c.y = e.clientY - drag.oy
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true
    const t = performance.now()
    drag.samples.push({ t, x: e.clientX, y: e.clientY })
    while (drag.samples.length > 2 && t - drag.samples[0].t > 90) drag.samples.shift()
    const s0 = drag.samples[0]
    const dtm = Math.max(1, t - s0.t)
    drag.vx = ((e.clientX - s0.x) / dtm) * 1000
    drag.vy = ((e.clientY - s0.y) / dtm) * 1000
  })
  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const { c } = drag
    c.el.classList.remove("drag")
    const fresh = drag.samples.length && performance.now() - drag.samples.at(-1).t < 90
    const vx = fresh ? drag.vx : 0
    const vy = fresh ? drag.vy : 0
    const speed = Math.hypot(vx, vy)
    drag = null
    if (speed > 900) return fling(c, vx, vy)
    if (c.home === "stack" && c.x - c.tx > c.w * 0.35) return fling(c, Math.max(vx, 1400), vy)
    if (c.x > W - 40 || c.x + c.w < 40 || c.y > H - 30) return fling(c, vx || (c.x > W / 2 ? 1400 : -1400), vy)
    c.mode = c.home === "brawl" && (phase === "brawl" || phase === "freeze") ? "brawl" : "stack"
    c.vx = vx
    c.vy = vy
    layout()
  }
  layer.addEventListener("pointerup", release)
  layer.addEventListener("pointercancel", release)
  layer.addEventListener("click", (e) => {
    const b = e.target.closest("button")
    const el = e.target.closest(".card")
    if (b && el?._card) dismiss(el._card)
  })
  addEventListener("pointermove", (e) => {
    pointer = { x: e.clientX, y: e.clientY, mouse: e.pointerType === "mouse" }
  }, { passive: true })
  document.addEventListener("pointerleave", () => (pointer = { x: -1e4, y: -1e4, mouse: false }))

  $("#clear").addEventListener("click", () => {
    for (const c of slotted()) dismiss(c)
  })
  skipBtn.addEventListener("click", skip)
  replayBtn.addEventListener("click", start)

  // Copying says so, the way anything else on this desktop would.
  $("#copy").addEventListener("click", async () => {
    const text = $("#cmd-text").textContent
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const sel = getSelection()
      const range = document.createRange()
      range.selectNodeContents($("#cmd-text"))
      sel.removeAllRanges()
      sel.addRange(range)
      document.execCommand("copy")
    }
    if (phase === "brawl" || phase === "freeze") return
    say({ app: "Clipboard", who: "Copied", text, stay: 2600 })
  })

  function tick() {
    const d = new Date()
    clockEl.textContent = `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}  ${clock()}`
  }
  tick()
  setInterval(tick, 10000)

  addEventListener("resize", () => {
    measure()
    homeInstall()
    for (const c of cards) {
      c.w = CW
      c.el.style.width = CW + "px"
      c.h = c.el.offsetHeight
    }
    layout()
  })

  window.__hero = () => ({ phase, clockMs, inst: { ...inst, rect: instRect(), gone: instGone() }, target, cards: cards.map((c) => [c.mode, Math.round(c.x), Math.round(c.y)]) })

  measure()
  ;(document.fonts?.ready ?? Promise.resolve()).then(() => {
    measure()
    start()
    lastFrame = performance.now()
    requestAnimationFrame(frame)
  })

  // For checking timing in a browser: ?t=21000 starts there.
  const jump = Number(new URLSearchParams(location.search).get("t"))
  if (jump > 0) {
    document.fonts?.ready.then(() => {
      while (si < script.length && script[si][0] <= jump) script[si++][1]()
      clockMs = jump
    })
  }
})()

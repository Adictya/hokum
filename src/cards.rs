//! The notification stack: an overlay (a click-through layer surface on Wayland) with its own
//! state. It shows for the first card, so it opens on the output focused then, and hides once
//! the last card has left.

use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use rune::{Align, AppSpec, Cursor, Cx, El, OverlayHandle, OverlayInput, OverlayOptions, OverlayPlacement, OverlaySpec, ScreenEdge, Transition, Tx, col, el, row, text};
use rune_kit::Kit;

use crate::card::{Cards, Note, Timeout, card, samples};
use crate::script::Script;
use crate::style::{Appearance, Behaviour};
use crate::theme::Theme;
use crate::watch::Config;

/// The gap around the stack, which leaves room for shadows.
pub const GUTTER: f32 = 18.0;
/// The overlay's height: room for a full stack, and short enough for small screens.
const HEIGHT: f32 = 820.0;
/// Long enough for the last card's exit to finish before the overlay hides.
const HIDE_AFTER: Duration = Duration::from_millis(900);

/// Why a notification closed (the spec's reasons).
#[derive(Clone, Copy)]
pub enum Reason {
    Expired = 1,
    Dismissed = 2,
    Closed = 3,
}

pub enum Out {
    Closed(u32, Reason),
    Action(u32, String),
}

pub struct Ui {
    /// Newest first.
    notes: Vec<Note>,
    paused: bool,
    pub settings: Behaviour,
    pub theme: Theme,
    script: Option<Script>,
    /// Decodes icons and pictures; made with the overlay's waker at startup.
    cache: Option<rune::ImageCache>,
    /// The desktop's colour scheme (`Appearance::System`).
    pub system_dark: bool,
    out: Sender<Out>,
    timer: Sender<Option<Instant>>,
    /// Its own overlay, to show and hide; None when headless.
    pub handle: Option<OverlayHandle<Ui>>,
    shown: bool,
    hide_at: Option<Instant>,
}

impl Ui {
    pub fn new(config: Config, out: Sender<Out>, timer: Sender<Option<Instant>>) -> Ui {
        let mut ui = Ui {
            notes: Vec::new(),
            paused: false,
            settings: config.loaded.behaviour.clone(),
            theme: config.loaded.theme.clone(),
            script: None,
            cache: None,
            system_dark: true,
            out,
            timer,
            handle: None,
            shown: false,
            hide_at: None,
        };
        ui.configure(config);
        ui
    }

    /// The config, its theme and the script from files (at startup, and whenever they change).
    /// A config with problems keeps the last good look.
    pub fn configure(&mut self, config: Config) {
        if !config.loaded.ok() {
            for p in &config.loaded.problems {
                eprintln!("hokum: config.kdl: {p}");
            }
        }
        if config.loaded.ok() || self.theme.rules.is_empty() && self.theme.templates.is_empty() {
            self.theme = config.loaded.theme.clone();
        }
        self.script = config.script.as_deref().and_then(|src| match Script::compile(src) {
            Ok(s) => Some(s),
            Err(e) => {
                eprintln!("hokum: script.rhai: {e}");
                None
            }
        });
        let behaviour = if config.loaded.ok() { config.loaded.behaviour } else { self.settings.clone() };
        self.apply(behaviour);
    }


    pub fn dark(&self) -> bool {
        match self.settings.appearance {
            Appearance::System => self.system_dark,
            Appearance::Light => false,
            Appearance::Dark => true,
        }
    }

    /// New behaviour: the overlay moves and resizes if it must, and cards restyle in place.
    pub fn apply(&mut self, settings: Behaviour) {
        if let Some(h) = &self.handle {
            h.set_placement(Some(placement(&settings)));
            h.resize(size(&self.theme, self.dark()));
        }
        if !settings.pause_on_hover {
            self.hover(false);
        }
        self.settings = settings;
    }

    /// Shows `n`, replacing the card with the same id or stack tag in place.
    pub fn upsert(&mut self, mut n: Note) {
        if let Some(script) = &self.script {
            match script.apply(&mut n) {
                Ok(true) => {}
                Ok(false) => {
                    let _ = self.out.send(Out::Closed(n.id, Reason::Expired));
                    return;
                }
                Err(e) => eprintln!("hokum: script.rhai: {e}"),
            }
        }
        crate::apps::record(&n.app);
        let routing = self.theme.routing(&n);
        if routing.hide {
            let _ = self.out.send(Out::Closed(n.id, Reason::Expired));
            return;
        }
        if let Some(t) = routing.timeout {
            n.timeout = t;
        }
        if let Some(cache) = &self.cache {
            n.decode(cache);
        }
        if self.settings.do_not_disturb && n.urgency < 2 && !routing.interrupt {
            let _ = self.out.send(Out::Closed(n.id, Reason::Expired));
            return;
        }
        let base = self.settings.stay();
        let timeout = match n.timeout {
            Timeout::Never => None,
            Timeout::After(d) => Some(d),
            Timeout::Default if n.urgency >= 2 => None,
            Timeout::Default if n.urgency == 0 => Some(base * 2 / 3),
            // Cards with buttons stay long enough to reach them.
            Timeout::Default if !n.actions.is_empty() => Some(base.max(Duration::from_secs(10))),
            Timeout::Default => Some(base),
        };
        match (self.paused, timeout) {
            (_, None) => {}
            (true, Some(t)) => n.left = Some(t),
            (false, Some(t)) => n.deadline = Some(Instant::now() + t),
        }
        let same = |o: &Note| o.id == n.id || (n.tag.is_some() && o.tag == n.tag && o.app == n.app);
        if let Some(i) = self.notes.iter().position(same) {
            let old = self.notes[i].id;
            if old != n.id {
                let _ = self.out.send(Out::Closed(old, Reason::Closed));
            }
            self.notes[i] = n;
        } else {
            self.notes.insert(0, n);
        }
        if !self.shown
            && let Some(h) = &self.handle
        {
            h.show();
            self.shown = true;
        }
        self.reschedule();
    }

    pub fn close(&mut self, id: u32, reason: Reason) {
        let before = self.notes.len();
        self.notes.retain(|n| n.id != id);
        if self.notes.len() != before {
            let _ = self.out.send(Out::Closed(id, reason));
            self.reschedule();
        }
    }

    fn clear(&mut self) {
        for n in self.notes.drain(..) {
            let _ = self.out.send(Out::Closed(n.id, Reason::Dismissed));
        }
        self.reschedule();
    }

    fn expire(&mut self, now: Instant) {
        let gone: Vec<u32> = self.notes.iter().filter(|n| n.deadline.is_some_and(|d| d <= now)).map(|n| n.id).collect();
        for id in gone {
            self.close(id, Reason::Expired);
        }
        if self.notes.is_empty() && self.shown && self.hide_at.is_some_and(|t| t <= now) {
            if let Some(h) = &self.handle {
                h.hide();
            }
            self.shown = false;
            self.paused = false;
        }
        self.reschedule();
    }

    fn reschedule(&mut self) {
        self.hide_at = match (self.notes.is_empty() && self.shown, self.hide_at) {
            (false, _) => None,
            (true, Some(t)) => Some(t),
            (true, None) => Some(Instant::now() + HIDE_AFTER),
        };
        let _ = self.timer.send(self.notes.iter().filter_map(|n| n.deadline).chain(self.hide_at).min());
    }
}

impl Cards for Ui {
    fn dismiss(&mut self, id: u32) {
        self.close(id, Reason::Dismissed);
    }

    fn invoke(&mut self, id: u32, key: &str) {
        let resident = self.notes.iter().find(|n| n.id == id).is_some_and(|n| n.resident);
        let _ = self.out.send(Out::Action(id, key.to_owned()));
        if !resident {
            self.dismiss(id);
        }
    }

    fn activate(&mut self, id: u32) {
        let default = self.notes.iter().find(|n| n.id == id).is_some_and(|n| n.has_default);
        if default { self.invoke(id, "default") } else { self.dismiss(id) }
    }

    /// Over the stack: pause every timer. Off it: resume where they were.
    fn hover(&mut self, on: bool) {
        let on = on && self.settings.pause_on_hover;
        if on == self.paused {
            return;
        }
        self.paused = on;
        let now = Instant::now();
        for n in &mut self.notes {
            if on {
                n.left = n.deadline.take().map(|d| d.saturating_duration_since(now));
            } else {
                n.deadline = n.left.take().map(|l| now + l.max(Duration::from_millis(1200)));
            }
        }
        self.reschedule();
    }
}

fn size(theme: &Theme, dark: bool) -> (f32, f32) {
    (theme.base(dark).width + GUTTER * 2.0, HEIGHT)
}

/// The corner of the screen for `s`.
fn placement(s: &Behaviour) -> OverlayPlacement {
    OverlayPlacement::Edge {
        edge: if s.position.bottom() { ScreenEdge::Bottom } else { ScreenEdge::Top },
        margin: 0.0,
        align: if s.position.right() { Align::End } else { Align::Start },
        inset: 0.0,
    }
}

/// The stack of cards for `notes` in a corner of its parent, as the overlay and the settings
/// preview both draw it.
pub fn stack<S: Cards>(notes: &[Note], s: &Behaviour, theme: &Theme, k: &Kit, more: Option<El>) -> El {
    let base = theme.base(k.dark);
    let between = base.spacing;
    let right = s.position.right();
    let bottom = s.position.bottom();
    let shown = notes.iter().take(s.max_shown.max(1)).map(|n| card::<S>(n, theme, k, right));
    let cards: Vec<El> = if bottom { shown.rev().collect() } else { shown.collect() };
    let (l, r) = if right { (None, Some(GUTTER)) } else { (Some(GUTTER), None) };
    let (t, b) = if bottom { (None, Some(GUTTER)) } else { (Some(GUTTER), None) };
    let mut col = col()
        .key("stack")
        .pin(l, t, r, b)
        .w(base.width)
        .gap(between)
        .on_hover_change(|s: &mut S, inside, _: &mut Tx| s.hover(inside));
    let more = more.map(|m| {
        let row = row().key("more-row").w_full().child(m);
        if right { row.justify_end() } else { row }
    });
    if bottom {
        col = col.children(more).children(cards);
    } else {
        col = col.children(cards).children(more);
    }
    col
}

fn more(hidden: usize, k: &Kit) -> El {
    let c = &k.c;
    row()
        .key("more")
        .role("button")
        .label("Clear all")
        .h(28.0)
        .px(12.0)
        .gap(8.0)
        .center_y()
        .radius(999.0)
        .fill(c.layer_01)
        .border(1.0, c.border_muted)
        .hover(c.hover)
        .press(c.pressed)
        .cursor(Cursor::Pointer)
        .hit()
        .on_press(|s: &mut Ui| s.clear())
        .child(text(format!("{hidden} more")).key("count").font(k.ty.small_medium).color(c.text_muted))
        .child(text("Clear all").key("clear").font(k.ty.small_medium).color(c.text_base))
        .transition(Transition::opacity().combined(Transition::scale(0.9)))
}

pub fn view(s: &Ui, _: &mut Cx<Ui>) -> El {
    let k = rune_theme_opencode::kit(s.dark());
    let hidden = s.notes.len().saturating_sub(s.settings.max_shown.max(1));
    let pill = (hidden > 0).then(|| more(hidden, k));
    el().key("root").w_full().h_full().child(stack::<Ui>(&s.notes, &s.settings, &s.theme, k, pill))
}

pub fn overlay(config: &Config) -> rune::ConfiguredOverlay<Ui> {
    OverlaySpec::new("hokum", size(&config.loaded.theme, true), view)
        .options(OverlayOptions {
            placement: Some(placement(&config.loaded.behaviour)),
            input: OverlayInput::Regions,
            ..OverlayOptions::default()
        })
        .setup(|ui, waker| ui.cache = Some(rune::ImageCache::new(waker)))
}

/// Sleeps until the earliest deadline, then expires what's due; each reschedule replaces it.
pub fn timers(rx: Receiver<Option<Instant>>, handle: OverlayHandle<Ui>) {
    std::thread::spawn(move || {
        let mut next: Option<Instant> = None;
        loop {
            let msg = match next {
                Some(t) => rx.recv_timeout(t.saturating_duration_since(Instant::now())),
                None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
            };
            match msg {
                Ok(t) => next = t,
                Err(RecvTimeoutError::Timeout) => {
                    next = None;
                    handle.update(|s, _| s.expire(Instant::now()));
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });
}

fn demo(s: &mut Ui) {
    for mut n in samples().into_iter().rev() {
        // Headless runs have no event loop to finish decodes, so decode and wait here.
        let cache = rune::ImageCache::new(std::sync::Arc::new(|| {}));
        n.decode(&cache);
        for img in n.icon.iter().chain(&n.image) {
            let _ = img.wait();
        }
        s.upsert(n);
    }
}

/// Scenes for the bundled themes.
fn bundled(s: &mut Ui, id: &str) {
    if let Ok(t) = crate::theme::resolve(id) {
        s.theme = t;
    }
    demo(s);
}

fn overflow(s: &mut Ui) {
    demo(s);
    for i in 0..3 {
        s.upsert(Note::new(10 + i, "GitHub", format!("Review requested #{}", 412 + i), "anomalyco/hokum: first release"));
    }
}

fn headless_state() -> Ui {
    let mut ui = Ui::new(crate::watch::load(), std::sync::mpsc::channel().0, std::sync::mpsc::channel().0);
    // `--theme light|dark` picks the appearance, as the desktop would.
    ui.system_dark = !std::env::args().any(|a| a == "light");
    ui
}

/// The overlay's view over a wallpaper-like gradient: headless renders clear to opaque black,
/// where an overlay would show the desktop behind it.
fn headless_view(s: &Ui, cx: &mut Cx<Ui>) -> El {
    let (top, bottom) = if s.dark() {
        (rune::oklch(0.32, 0.06, 265.0), rune::oklch(0.22, 0.05, 300.0))
    } else {
        (rune::oklch(0.86, 0.05, 230.0), rune::oklch(0.78, 0.07, 290.0))
    };
    el().key("desktop").w_full().h_full().gradient(top, bottom).child(view(s, cx))
}

/// The cards as an app of their own, for headless snapshots (`hokum service --snap`).
pub fn headless() {
    let theme = crate::config::load().theme;
    let spec = AppSpec {
        scenes: &[
            ("demo", demo),
            ("overflow", overflow),
            ("soft", |s| bundled(s, "soft")),
            ("crisp", |s| bundled(s, "crisp")),
            ("capsule", |s| bundled(s, "capsule")),
            ("ribbon", |s| bundled(s, "ribbon")),
            ("terminal", |s| bundled(s, "terminal")),
            ("bubble", |s| bundled(s, "bubble")),
            ("signal", |s| bundled(s, "signal")),
            ("pill", |s| bundled(s, "pill")),
        ],
        fonts: rune_theme_opencode::FONTS,
        families: rune_theme_opencode::FAMILIES,
        ..AppSpec::new("Hokum", size(&theme, true), headless_state, headless_view)
    };
    rune::App::new(spec).run();
}

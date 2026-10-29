//! The history: a panel down the right edge of the screen (a full-screen layer surface, like
//! swaync's control center) listing the notifications that came in, newest first, until they're
//! dismissed or cleared. Do not disturb keeps cards off the screen but not out of the history.
//! It lasts as long as the service: a restart or a new session starts it empty.
//!
//! `hokum history [toggle|open|close|clear]` drives it; a click outside the panel or Esc
//! closes it.

use std::sync::mpsc::Sender;

use rune::{AppHandle, AppSpec, Cursor, Cx, El, KeyEvent, KeyPolicy, OverlayHandle, OverlayInput, OverlayOptions, OverlayPlacement, OverlaySpec, ScrollSpec, Tx, col, el, row, text};
use rune_kit::{ControlSize, Kit, Switch};

use crate::card::{Cards, Note, Timeout, card};
use crate::cards::Out;
use crate::style::{Appearance, Behaviour};
use crate::template::Ctx;
use crate::theme::{Fill, Theme};
use crate::watch::Config;

/// Older notifications fall off the end.
const LIMIT: usize = 100;
/// Between the panel and the screen's edges.
const MARGIN: f32 = 6.0;
/// Inside the panel, around the cards.
const PAD: f32 = 10.0;

pub struct Ui {
    /// Newest first.
    notes: Vec<Note>,
    theme: Theme,
    settings: Behaviour,
    pub system_dark: bool,
    cache: Option<rune::ImageCache>,
    out: Sender<Out>,
    shown: bool,
    /// Its own overlay, to show and hide; None when headless.
    pub handle: Option<OverlayHandle<Ui>>,
    /// The cards, which own the bus side of actions.
    pub cards: Option<OverlayHandle<crate::cards::Ui>>,
    /// The settings window, which owns Do not disturb.
    pub window: Option<AppHandle<crate::settings::Ui>>,
}

impl Ui {
    pub fn new(config: &Config, out: Sender<Out>) -> Ui {
        let ui = Ui {
            notes: Vec::new(),
            theme: config.loaded.theme.clone(),
            settings: config.loaded.behaviour.clone(),
            system_dark: true,
            cache: None,
            out,
            shown: false,
            handle: None,
            cards: None,
            window: None,
        };
        ui.publish();
        ui
    }

    pub fn dark(&self) -> bool {
        match self.settings.appearance {
            Appearance::System => self.system_dark,
            Appearance::Light => false,
            Appearance::Dark => true,
        }
    }

    /// The look and behaviour the cards settled on.
    pub fn restyle(&mut self, theme: Theme, settings: Behaviour) {
        self.theme = theme;
        self.settings = settings;
    }

    /// Keeps `n`, replacing the entry with the same id or stack tag (a volume bar) in place.
    pub fn record(&mut self, mut n: Note) {
        n.deadline = None;
        n.left = None;
        n.timeout = Timeout::Never;
        if let Some(cache) = &self.cache {
            n.decode(cache);
        }
        let same = |o: &Note| o.id == n.id || (n.tag.is_some() && o.tag == n.tag && o.app == n.app);
        match self.notes.iter().position(same) {
            Some(i) => {
                n.slot = self.notes[i].slot;
                self.notes.remove(i);
            }
            None => n.slot = n.id,
        }
        self.notes.insert(0, n);
        self.notes.truncate(LIMIT);
        self.changed();
    }

    /// The app closed it (`CloseNotification`): it's no longer news.
    pub fn forget(&mut self, id: u32) {
        let before = self.notes.len();
        self.notes.retain(|n| n.id != id);
        if self.notes.len() != before {
            self.changed();
        }
    }

    pub fn clear(&mut self) {
        if !self.notes.is_empty() {
            self.notes.clear();
            self.changed();
        }
    }

    pub fn count(&self) -> u32 {
        self.notes.len() as u32
    }

    pub fn toggle(&mut self) {
        if self.shown { self.close() } else { self.open() }
    }

    pub fn open(&mut self) {
        if let Some(h) = &self.handle {
            h.show();
            h.request_keys();
        }
        self.cover(true);
    }

    pub fn close(&mut self) {
        if let Some(h) = &self.handle {
            h.hide();
        }
        self.cover(false);
    }

    fn cover(&mut self, on: bool) {
        if self.shown != on
            && let Some(c) = &self.cards
        {
            c.update(move |c, _| c.cover(on));
        }
        self.shown = on;
    }

    fn changed(&self) {
        self.publish();
    }

    fn publish(&self) {
        let _ = self.out.send(Out::History(self.count()));
    }

    fn toggle_dnd(&mut self) {
        if let Some(w) = &self.window {
            w.update(|w, _| w.toggle_dnd());
        }
    }
}

impl Cards for Ui {
    fn dismiss(&mut self, id: u32) {
        self.forget(id);
    }

    /// A button: the app hears it as if the card were still up, and the panel gets out of the
    /// way for whatever it opens.
    fn invoke(&mut self, id: u32, key: &str) {
        let Some(n) = self.notes.iter().find(|n| n.id == id) else { return };
        let token = rune::press_activation_token(n.desktop.as_deref());
        let argv = n.command(key).map(<[String]>::to_vec);
        let key = key.to_owned();
        if let Some(c) = &self.cards {
            c.update(move |c, _| c.invoke_remembered(id, key, token, argv));
        }
        self.forget(id);
        self.close();
    }

    /// A click on a card does its default action, when it has one.
    fn activate(&mut self, id: u32) {
        let default = self.notes.iter().find(|n| n.id == id).is_some_and(|n| n.has_default || n.command("default").is_some());
        if default {
            self.invoke(id, "default");
        }
    }

    fn hover(&mut self, _: bool) {}
}

fn header(s: &Ui, k: &Kit, cx: &Ctx) -> El {
    let c = &k.c;
    let dnd = s.settings.do_not_disturb;
    let switch = Switch::new(dnd)
        .label("Do not disturb")
        .hide_label()
        .control_size(ControlSize::Small)
        .on_toggle(|s: &mut Ui| s.toggle_dnd())
        .build(k)
        .key("dnd-switch");
    let clear = row()
        .key("clear")
        .role("button")
        .label("Clear all")
        .h(26.0)
        .px(10.0)
        .center_y()
        .radius(cx.t.radius.min(8.0))
        .hover(c.hover)
        .press(c.pressed)
        .cursor(Cursor::Pointer)
        .on_press(|s: &mut Ui| s.clear())
        .child(text("Clear").key("clear-label").font(k.ty.small_medium).color(cx.ink(&cx.t.text)));
    row()
        .key("header")
        .w_full()
        .h(36.0)
        .px(4.0)
        .gap(10.0)
        .center_y()
        .child(text("Notifications").key("title").font(k.ty.ui_medium).color(cx.ink(&cx.t.text)).grow(1.0))
        .child(text("Do not disturb").key("dnd-label").font(k.ty.small).color(cx.ink(&cx.t.muted)))
        .child(switch)
        .children((!s.notes.is_empty()).then_some(clear))
}

pub fn view(s: &Ui, _: &mut Cx<Ui>) -> El {
    let k = rune_theme_opencode::kit(s.dark());
    let t = s.theme.base(k.dark);
    let blank = Note::new(0, "", "", "");
    let cx = Ctx { n: &blank, t: &t, k, accent: k.c.text_base };
    let list = if s.notes.is_empty() {
        col().key("empty").w_full().grow(1.0).center().child(text("No notifications").key("empty-label").font(k.ty.ui).color(cx.ink(&t.faint)))
    } else {
        let cards = s.notes.iter().map(|n| card::<Ui>(n, &s.theme, k, true));
        col()
            .key("list")
            .w_full()
            .grow(1.0)
            .h(0.0)
            .scroll(ScrollSpec { stick_bottom: false })
            .clip_fade(0.0, 0.0, 0.0, 16.0)
            .child(col().key("cards").w_full().gap(t.spacing).children(cards))
    };
    let mut panel = col()
        .key("panel")
        .pin(None, Some(MARGIN), Some(MARGIN), Some(MARGIN))
        .w(t.width + 2.0 * PAD)
        .padding(PAD)
        .gap(PAD)
        .radius(t.radius)
        .hit()
        .child(header(s, k, &cx))
        .child(list);
    panel = match &t.fill {
        Fill::Solid(f) => panel.fill(cx.paint(f)),
        Fill::Gradient(a, b) => panel.gradient(cx.paint(a), cx.paint(b)),
    };
    if let Some((w, b)) = &t.border {
        panel = panel.border(*w, cx.paint(b));
    }
    let backdrop = el().key("backdrop").pin(Some(0.0), Some(0.0), Some(0.0), Some(0.0)).hit().on_press(|s: &mut Ui| s.close());
    el().key("root").w_full().h_full().child(backdrop).child(panel)
}

fn on_key(s: &mut Ui, e: &KeyEvent, _: &mut Tx) -> bool {
    if e.key != rune::Key::Escape {
        return false;
    }
    s.close();
    true
}

/// The whole screen the compositor picks (the focused one), clear and click-swallowing outside
/// the panel so a click there closes it.
pub fn overlay() -> rune::ConfiguredOverlay<Ui> {
    OverlaySpec::new("hokum-history", (420.0, 800.0), view)
        .options(OverlayOptions {
            placement: Some(OverlayPlacement::FullScreen),
            keys: KeyPolicy::OnDemand,
            input: OverlayInput::Regions,
            ..OverlayOptions::default()
        })
        .on_key(on_key)
        .setup(|ui, waker| ui.cache = Some(rune::ImageCache::new(waker)))
}

/// Headless runs have no event loop to finish decodes, so decode and wait here.
fn decoded(mut n: Note) -> Note {
    let cache = rune::ImageCache::new(std::sync::Arc::new(|| {}));
    n.decode(&cache);
    for img in n.icon.iter().chain(&n.image) {
        let _ = img.wait();
    }
    n
}

fn scene(s: &mut Ui) {
    s.notes = crate::card::samples().into_iter().map(decoded).collect();
}

fn scene_empty(s: &mut Ui) {
    s.notes.clear();
}

fn headless_state() -> Ui {
    let config = crate::watch::load();
    let mut ui = Ui::new(&config, std::sync::mpsc::channel().0);
    ui.system_dark = !std::env::args().any(|a| a == "light");
    ui
}

/// The panel over a wallpaper-like gradient, as `cards::headless` draws the stack.
fn headless_view(s: &Ui, cx: &mut Cx<Ui>) -> El {
    let (top, bottom) = (rune::oklch(0.32, 0.06, 265.0), rune::oklch(0.22, 0.05, 300.0));
    el().key("desktop").w_full().h_full().gradient(top, bottom).child(view(s, cx))
}

/// `hokum history --snap <png> --scene history|history-empty`.
pub fn headless() {
    let spec = AppSpec {
        scenes: &[("history", scene), ("history-empty", scene_empty)],
        fonts: rune_theme_opencode::FONTS,
        families: rune_theme_opencode::FAMILIES,
        ..AppSpec::new("Hokum", (1280.0, 800.0), headless_state, headless_view)
    };
    rune::App::new(spec).run();
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::{Receiver, channel};

    use super::*;

    fn ui() -> (Ui, Receiver<Out>) {
        let (out, rx) = channel();
        (Ui::new(&crate::watch::load(), out), rx)
    }

    fn volume(id: u32, value: f32) -> Note {
        let mut n = Note::new(id, "pamixer", "Volume", "");
        n.value = Some(value);
        n.tag = Some("volume".into());
        n
    }

    #[test]
    fn newest_first_and_a_tagged_update_replaces_its_entry() {
        let (mut ui, _rx) = ui();
        ui.record(volume(1, 0.4));
        ui.record(Note::new(2, "Slack", "Dax", "ship it"));
        ui.record(volume(3, 0.5));
        let notes: Vec<(u32, u32, Option<f32>)> = ui.notes.iter().map(|n| (n.id, n.slot, n.value)).collect();
        assert_eq!(notes, vec![(3, 1, Some(0.5)), (2, 2, None)]);
    }

    #[test]
    fn keeps_at_most_the_limit_and_announces_the_count() {
        let (mut ui, rx) = ui();
        for id in 1..=(LIMIT as u32 + 5) {
            ui.record(Note::new(id, "App", format!("{id}"), ""));
        }
        assert_eq!(ui.notes.len(), LIMIT);
        assert_eq!(ui.notes[0].id, LIMIT as u32 + 5);
        ui.forget(LIMIT as u32 + 5);
        ui.clear();
        let last: Vec<Out> = rx.try_iter().collect();
        assert_eq!(last.last(), Some(&Out::History(0)));
    }

    #[test]
    fn a_click_without_a_default_action_keeps_the_entry() {
        let (mut ui, _rx) = ui();
        ui.record(Note::new(7, "App", "Hi", ""));
        ui.activate(7);
        assert_eq!(ui.count(), 1);
        ui.dismiss(7);
        assert_eq!(ui.count(), 0);
    }
}

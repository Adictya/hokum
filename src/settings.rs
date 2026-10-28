//! The settings window, hosted by the running service beside the overlay. It picks a theme and
//! sets behaviour and per-app routing in config.kdl (keeping its comments); the look itself is
//! left to theme files, which coding agents write from docs/themes.md. Editing the file by hand
//! updates the window. The preview draws the same cards with the same code.

use std::collections::HashMap;

use rune::{AppSpec, Color, Cursor, Cx, El, Image, OverlayHandle, ScrollSpec, Tx, WindowOptions, col, el, row, text};
use rune_kit::{Button, ButtonVariant, ControlSize, Kit, SegmentedControl, Switch};
use zbus::blocking::Connection;

use crate::card::{Cards, Note, card, samples, tint};
use crate::cards::stack;
use crate::config::{AppRule, Edit, Loaded, Value};
use crate::style::{Appearance, Position};
use crate::theme::Theme;
use crate::watch::Config;

const SIDEBAR: f32 = 560.0;
pub const SIZE: (f32, f32) = (1100.0, 780.0);

/// Whether this process answers `org.freedesktop.Notifications`.
#[derive(Clone, PartialEq, Debug)]
pub enum Daemon {
    Checking,
    Hokum,
    Other(String),
}

#[derive(Clone, PartialEq, Debug)]
enum ScriptStatus {
    None,
    Loaded,
    Broken(String),
}

pub struct Ui {
    loaded: Loaded,
    pub daemon: Daemon,
    pub overlay: Option<OverlayHandle<crate::cards::Ui>>,
    pub bus: Option<Connection>,
    pub handle: Option<rune::AppHandle<Ui>>,
    sent: u32,
    error: Option<String>,
    script: ScriptStatus,
    copied: bool,
    /// Every theme the gallery offers: (id, name, the theme resolved).
    gallery: Vec<(String, String, Theme)>,
    /// Apps that have sent notifications, and apps the config has rules for.
    apps: Vec<String>,
    icons: HashMap<String, Option<Image>>,
    /// The preview's cards and the gallery's card, with icons decoded by `cache`.
    samples: Vec<Note>,
    tile_note: Note,
    cache: Option<rune::ImageCache>,
}

impl Cards for Ui {
    fn dismiss(&mut self, _: u32) {}
    fn invoke(&mut self, _: u32, _: &str) {}
    fn activate(&mut self, _: u32) {}
    fn hover(&mut self, _: bool) {}
}

impl Ui {
    /// Changes config.kdl, then reloads everything from it.
    fn edit(&mut self, f: impl FnOnce(&mut Edit, &Loaded)) {
        let mut e = match Edit::open() {
            Ok(e) => e,
            Err(msg) => {
                self.error = Some(msg);
                return;
            }
        };
        f(&mut e, &self.loaded);
        self.error = e.save().err().map(|err| format!("Couldn't save config.kdl: {err}"));
        self.reload();
    }

    fn reload(&mut self) {
        let config = crate::watch::load();
        if let Some(o) = &self.overlay {
            let c = config.clone();
            o.update(move |ui, _| ui.configure(c));
        }
        self.configure(config);
    }

    /// The config, its theme and the script from files (at startup, and whenever they change).
    pub fn configure(&mut self, config: Config) {
        self.loaded = config.loaded;
        self.copied = false;
        self.script = match config.script.as_deref().map(crate::script::Script::compile) {
            None => ScriptStatus::None,
            Some(Ok(_)) => ScriptStatus::Loaded,
            Some(Err(e)) => ScriptStatus::Broken(e),
        };
        self.gallery = crate::theme::available()
            .into_iter()
            .filter_map(|(id, name)| crate::theme::resolve(&id).ok().map(|t| (id, name, t)))
            .collect();
        let (ruled, _) = crate::config::app_rules(&self.loaded.own);
        let mut apps = crate::apps::seen();
        for (app, _) in ruled {
            if !apps.iter().any(|a| a.eq_ignore_ascii_case(&app)) {
                apps.push(app);
            }
        }
        self.apps = apps;
        self.decode_icons();
    }

    fn decode_icons(&mut self) {
        let Some(cache) = &self.cache else { return };
        for app in &self.apps {
            self.icons.entry(app.clone()).or_insert_with(|| crate::icons::for_app("", None, app).map(|p| cache.file(p, 64.0, 2.0)));
        }
    }

    fn pick_theme(&mut self, id: String) {
        self.edit(|e, _| e.set_theme(&id));
    }

    fn edit_config(&mut self) {
        let p = crate::config::path();
        if !p.exists() {
            let written = p.parent().map_or(Ok(()), std::fs::create_dir_all).and_then(|_| std::fs::write(&p, crate::config::DEFAULT));
            if let Err(e) = written {
                self.error = Some(format!("Couldn't write {}: {e}", p.display()));
                return;
            }
        }
        open(&p);
    }

    fn edit_script(&mut self) {
        let path = crate::script::path();
        if !path.exists() {
            let written = path.parent().map_or(Ok(()), std::fs::create_dir_all).and_then(|_| std::fs::write(&path, crate::script::STARTER));
            if let Err(e) = written {
                self.error = Some(format!("Couldn't write {}: {e}", path.display()));
                return;
            }
        }
        open(&path);
    }

    /// Writes one behaviour value, or removes it when it's what the theme already says.
    fn behave(&mut self, key: &'static str, value: Value, same: bool) {
        self.edit(|e, _| if same { e.remove_behaviour(key) } else { e.set_behaviour(key, value) });
    }

    fn set_app(&mut self, app: String, action: &'static str, value: Option<Vec<Value>>) {
        self.edit(|e, _| e.set_app(&app, action, value));
    }

    /// Take `org.freedesktop.Notifications` from whichever daemon has it.
    fn take_over(&mut self) {
        let (Some(bus), Some(handle)) = (self.bus.clone(), self.handle.clone()) else { return };
        self.daemon = Daemon::Checking;
        std::thread::spawn(move || {
            let daemon = crate::bus::claim(&bus, true);
            handle.update(move |s, _| s.daemon = daemon);
        });
    }

    fn test(&mut self) {
        let Some(o) = &self.overlay else { return };
        let mut all = samples();
        let mut n = all.remove(self.sent as usize % all.len());
        // Far from the ids the bus hands out.
        n.id = u32::MAX - self.sent;
        self.sent += 1;
        o.update(move |c, _| c.upsert(n));
    }
}

fn kit(s: &Ui, cx: &Cx<Ui>) -> (&'static Kit, &'static Kit) {
    let window = rune_theme_opencode::kit(cx.system_dark());
    let preview = match s.loaded.behaviour.appearance {
        Appearance::System => window,
        Appearance::Light => rune_theme_opencode::kit(false),
        Appearance::Dark => rune_theme_opencode::kit(true),
    };
    (window, preview)
}

fn section(k: &Kit, key: &str, title: El, rows: Vec<El>) -> El {
    let c = &k.c;
    let n = rows.len();
    let mut card = col().key("card").padding(4.0).radius(12.0).fill(c.bg_base).border(1.0, c.border_muted);
    for (i, r) in rows.into_iter().enumerate() {
        card = card.child(r);
        if i + 1 < n {
            card = card.child(el().key(format!("sep{i}")).h(1.0).ml(12.0).mr(12.0).fill(c.border_muted));
        }
    }
    col().key(key).gap(8.0).child(title).child(card)
}

fn heading(k: &Kit, title: impl Into<String>) -> El {
    text(title).key("header").font(k.ty.ui_medium.lh(16.0)).color(k.c.text_muted).ml(12.0)
}

fn setting(k: &Kit, key: &str, title: &str, description: Option<&str>, control: El) -> El {
    let c = &k.c;
    let mut copy = col().key("copy").grow(1.0).shrink().gap(2.0).child(text(title).key("title").font(k.ty.ui).color(c.text_base));
    if let Some(d) = description {
        copy = copy.child(text(d).key("description").font(k.ty.small).color(c.text_muted).wrap().w_full());
    }
    row()
        .key(key.to_owned())
        .label(title)
        .w_full()
        .min_h(if description.is_some() { 56.0 } else { 44.0 })
        .px(12.0)
        .py(8.0)
        .gap(16.0)
        .center_y()
        .child(copy)
        .child(control)
}

fn toggle(k: &Kit, key: &str, title: &str, description: Option<&str>, on: bool, f: impl Fn(&mut Ui) + Clone + 'static) -> El {
    let c = &k.c;
    let g = f.clone();
    setting(k, key, title, description, Switch::new(on).hide_label().on_toggle(move |s: &mut Ui| g(s)).build(k))
        .radius(8.0)
        .hover(c.hover)
        .cursor(Cursor::Pointer)
        .on_press(move |s: &mut Ui| f(s))
}

/// A segmented control over `options`, nothing selected when `current` isn't one of them.
fn choice<T: Copy + PartialEq + 'static>(
    k: &Kit,
    key: &str,
    options: &'static [(T, &'static str)],
    current: Option<T>,
    width: f32,
    pick: impl Fn(&mut Ui, T) + Clone + 'static,
) -> El {
    let labels: Vec<&str> = options.iter().map(|o| o.1).collect();
    let i = current.and_then(|c| options.iter().position(|o| o.0 == c));
    SegmentedControl::new(&labels, i)
        .width(Some(width))
        .on_pick(move |s: &mut Ui, i: usize, _: &mut Tx| pick(s, options[i].0))
        .build(k)
        .key(key.to_owned())
}

fn button(k: &Kit, key: &str, label: &str, f: fn(&mut Ui)) -> El {
    Button::new(label).variant(ButtonVariant::Ghost).control_size(ControlSize::Regular).on_press(f).build(k).key(key.to_owned())
}

/// A tiny screen with a target in each corner.
fn corner_picker(k: &Kit, current: Position, theme_value: Position) -> El {
    let c = &k.c;
    let corners = [
        (Position::TopLeft, Some(4.0), Some(4.0), None, None, "Top left"),
        (Position::TopRight, None, Some(4.0), Some(4.0), None, "Top right"),
        (Position::BottomLeft, Some(4.0), None, None, Some(4.0), "Bottom left"),
        (Position::BottomRight, None, None, Some(4.0), Some(4.0), "Bottom right"),
    ];
    let mut screen = el().key("screen").size(84.0, 52.0).radius(8.0).fill(c.bg_deep).border(1.0, c.border_base);
    for (i, (p, l, t, r, b, label)) in corners.into_iter().enumerate() {
        let on = p == current;
        screen = screen.child(
            el().key(format!("corner{i}"))
                .role("radio")
                .label(label)
                .pin(l, t, r, b)
                .size(30.0, 16.0)
                .radius(4.0)
                .fill(if on { c.text_base } else { c.layer_02 })
                .hover(c.hover)
                .cursor(Cursor::Pointer)
                .on_press(move |s: &mut Ui| s.behave("position", Value::Text(p.word().into()), p == theme_value)),
        );
    }
    screen
}

const STAY: &[(u32, &str)] = &[(4, "4 s"), (6, "6 s"), (10, "10 s")];
const SHOWN: &[(usize, &str)] = &[(3, "3"), (5, "5"), (8, "8")];
const APPEARANCE: &[(Appearance, &str)] = &[(Appearance::System, "System"), (Appearance::Light, "Light"), (Appearance::Dark, "Dark")];
/// Per-app stay: 0 is the theme's default, u32::MAX until dismissed.
const APP_STAY: &[(u32, &str)] = &[(0, "Default"), (3, "3 s"), (10, "10 s"), (u32::MAX, "Pinned")];

fn status(k: &Kit, s: &Ui) -> El {
    let c = &k.c;
    let (dot, line) = match &s.daemon {
        Daemon::Checking => (c.icon_faint, "Checking the notification daemon…".to_owned()),
        Daemon::Hokum => (c.success.icon, "Hokum is showing your notifications".to_owned()),
        Daemon::Other(name) => (c.warning.icon, format!("{name} is showing your notifications instead")),
    };
    let mut r = row()
        .key("status")
        .w_full()
        .gap(10.0)
        .center_y()
        .child(el().key("dot").size(8.0, 8.0).radius(4.0).fill(dot))
        .child(text(line).key("line").font(k.ty.ui).color(c.text_muted).grow(1.0).shrink().truncate());
    if matches!(s.daemon, Daemon::Other(_)) {
        r = r.child(
            Button::new("Use Hokum")
                .variant(ButtonVariant::Neutral)
                .control_size(ControlSize::Regular)
                .on_press(|s: &mut Ui| s.take_over())
                .build(k)
                .key("take-over"),
        );
    }
    r.child(button(k, "test", "Send test", |s| s.test()))
}

const TILE: (f32, f32) = (108.0, 72.0);

/// One theme in the gallery: a real card drawn with it, scaled down.
fn tile(s: &Ui, k: &Kit, i: usize, id: &str, name: &str, theme: &Theme) -> El {
    let c = &k.c;
    let on = s.loaded.base_id == id;
    let w = theme.base(k.dark).width;
    let scale = (TILE.0 - 12.0) / w;
    let inner = TILE.1 / scale;
    let mini = col()
        .key("mini")
        .size(w, inner)
        .absolute((TILE.0 - w) / 2.0, (TILE.1 - inner) / 2.0)
        .justify_center()
        .scale(scale)
        .child(card::<Ui>(&s.tile_note, theme, k, true));
    let pick = id.to_owned();
    let stage = el()
        .key("stage")
        .size(TILE.0, TILE.1)
        .radius(10.0)
        .fill(c.bg_deep)
        .border(if on { 2.0 } else { 1.0 }, if on { c.text_base } else { c.border_muted })
        .clip_soft(0.0)
        .child(mini)
        // Over the card, so a click picks the theme rather than pressing the card.
        .child(
            el().key("pick")
                .role("radio")
                .label(name.to_owned())
                .pin(Some(0.0), Some(0.0), Some(0.0), Some(0.0))
                .radius(10.0)
                .hover(c.hover)
                .press(c.pressed)
                .cursor(Cursor::Pointer)
                .on_press(move |s: &mut Ui| s.pick_theme(pick.clone())),
        );
    col()
        .key(format!("theme-{i}"))
        .w(TILE.0)
        .gap(6.0)
        .child(stage)
        .child(text(name.to_owned()).key("name").font(k.ty.small_medium).color(if on { c.text_base } else { c.text_muted }).self_center().truncate())
}

fn themes(s: &Ui, k: &Kit) -> El {
    let c = &k.c;
    let mut tiles: Vec<El> = s.gallery.iter().enumerate().map(|(i, (id, name, t))| tile(s, k, i, id, name, t)).collect();
    let id = &s.loaded.base_id;
    // A theme by path (or one that doesn't load) isn't in the gallery; show it anyway.
    let found = s.loaded.base.id == *id;
    let name = if found { s.loaded.base.name.as_str() } else { "Custom" };
    if !s.gallery.iter().any(|g| g.0 == *id) {
        tiles.push(tile(s, k, tiles.len(), id, name, &s.loaded.base));
    }
    let actions = row()
        .key("theme-actions")
        .gap(4.0)
        .child(button(k, "edit-config", "Edit config.kdl", |s| s.edit_config()))
        .child(button(k, "open-folder", "Open folder", |_| {
            let dir = crate::style::dir();
            let _ = std::fs::create_dir_all(dir.join("themes"));
            open(&dir);
        }));
    let mut top = col().key("theme-pick").w_full().padding(12.0).gap(12.0).child(row().key("tiles").w_full().gaps(12.0, 10.0).flex_wrap().children(tiles));
    if !crate::theme::is_bundled(id) {
        let line = match crate::theme::find(id) {
            Some(crate::theme::Found::File(p)) => format!("Custom theme \u{201c}{name}\u{201d} from {}", home(&p)),
            _ => format!("No theme called \u{201c}{id}\u{201d}; showing Capsule"),
        };
        top = top.child(text(line).key("custom").font(k.ty.small).color(c.text_muted).wrap().w_full().selectable(true));
    }
    top = top.child(actions);
    for (i, p) in s.loaded.problems.iter().take(6).enumerate() {
        top = top.child(text(p.to_string()).key(format!("problem-{i}")).font(k.ty.small.mono()).color(c.danger.fg).wrap().w_full());
    }
    let (dot, line) = match &s.script {
        ScriptStatus::None => (c.icon_faint, "No script. A script can rewrite, route or drop notifications.".to_owned()),
        ScriptStatus::Loaded => (c.success.icon, format!("{} is running", crate::script::path().display())),
        ScriptStatus::Broken(e) => (c.danger.icon, format!("Script error: {e}")),
    };
    let script = row()
        .key("script")
        .w_full()
        .px(12.0)
        .py(8.0)
        .gap(10.0)
        .center_y()
        .child(el().key("dot").size(8.0, 8.0).radius(4.0).fill(dot))
        .child(text(line).key("line").font(k.ty.small).color(c.text_muted).wrap().grow(1.0).shrink().w(0.0))
        .child(button(k, "edit-script", if s.script == ScriptStatus::None { "Create script" } else { "Edit script" }, |s| s.edit_script()));
    section(k, "themes", heading(k, "Theme"), vec![top, script])
}

const DOCS: &str = "https://github.com/anomalyco/hokum/blob/dev/docs/themes.md";
const PROMPT: &str =
    "Read https://github.com/anomalyco/hokum/blob/dev/docs/themes.md and create a Hokum theme for me, then switch my config to it. I want it to look like: ";

/// Custom themes are written by a coding agent from the docs, not in this window.
fn own_theme(s: &Ui, k: &Kit) -> El {
    let c = &k.c;
    let body = col()
        .key("own")
        .w_full()
        .padding(12.0)
        .gap(10.0)
        .child(
            text("A theme can change every part of a card, more than this window can show. Ask your coding agent to write one: paste this prompt and describe the look you want.")
                .key("about")
                .font(k.ty.small)
                .color(c.text_muted)
                .wrap()
                .w_full(),
        )
        .child(
            col()
                .key("prompt")
                .w_full()
                .padding(10.0)
                .radius(8.0)
                .fill(c.bg_deep)
                .border(1.0, c.border_muted)
                .child(text(PROMPT).key("text").font(k.ty.small.mono()).color(c.text_base).wrap().w_full().selectable(true)),
        )
        .child(
            row()
                .key("own-actions")
                .gap(4.0)
                .child(
                    Button::new(if s.copied { "Copied" } else { "Copy prompt" })
                        .variant(ButtonVariant::Ghost)
                        .control_size(ControlSize::Regular)
                        .on_press_tx(|s: &mut Ui, tx: &mut Tx| {
                            tx.copy(PROMPT);
                            s.copied = true;
                        })
                        .build(k)
                        .key("copy-prompt"),
                )
                .child(
                    Button::new("Open the guide")
                        .variant(ButtonVariant::Ghost)
                        .control_size(ControlSize::Regular)
                        .on_press_tx(|_: &mut Ui, tx: &mut Tx| {
                            let _ = tx.open_url(DOCS);
                        })
                        .build(k)
                        .key("open-docs"),
                ),
        );
    section(k, "own-theme", heading(k, "Make your own theme"), vec![body])
}

fn behaviour(s: &Ui, k: &Kit) -> El {
    let b = &s.loaded.behaviour;
    let theirs = s.loaded.base.behaviour();
    let stay = Some(b.stay.round() as u32);
    section(
        k,
        "behaviour",
        heading(k, "Behaviour"),
        vec![
            setting(k, "position", "Position", Some("The corner of the focused screen"), corner_picker(k, b.position, theirs.position)),
            setting(k, "stay", "Stay for", Some("When the app doesn't say. Critical ones stay until dismissed"), {
                let theirs = theirs.stay;
                choice(k, "stay-control", STAY, stay, 180.0, move |s, v| s.behave("stay", Value::Number(v as f64), v as f32 == theirs))
            }),
            setting(k, "shown", "Show at most", None, {
                let theirs = theirs.max_shown;
                choice(k, "shown-control", SHOWN, Some(b.max_shown), 180.0, move |s, v| s.behave("show-at-most", Value::Number(v as f64), v == theirs))
            }),
            toggle(k, "pause", "Pause while hovered", Some("Timers wait while the pointer is over a card"), b.pause_on_hover, move |s: &mut Ui| {
                let v = !s.loaded.behaviour.pause_on_hover;
                let theirs = s.loaded.base.behaviour().pause_on_hover;
                s.behave("pause-on-hover", Value::Flag(v), v == theirs)
            }),
            toggle(k, "dnd", "Do not disturb", Some("Only critical notifications and apps allowed to interrupt show"), b.do_not_disturb, move |s: &mut Ui| {
                let v = !s.loaded.behaviour.do_not_disturb;
                let theirs = s.loaded.base.behaviour().do_not_disturb;
                s.behave("do-not-disturb", Value::Flag(v), v == theirs)
            }),
            setting(k, "appearance", "Appearance", None, {
                let theirs = theirs.appearance;
                choice(k, "appearance-control", APPEARANCE, Some(b.appearance), 300.0, move |s, v| {
                    s.behave("appearance", Value::Text(v.word().into()), v == theirs)
                })
            }),
        ],
    )
}

/// One app's choices, kept as `rule app="…"` in config.kdl.
fn app_row(s: &Ui, k: &Kit, i: usize, app: &str, rule: &AppRule) -> El {
    let c = &k.c;
    let mark = match s.icons.get(app).cloned().flatten() {
        Some(img) => el().key("icon").size(22.0, 22.0).radius(6.0).pixels_fit(img.pixels(), rune::SurfaceFit::Fit),
        None => el()
            .key("icon")
            .size(22.0, 22.0)
            .radius(6.0)
            .center()
            .fill(tint(app))
            .child(text(app.chars().find(|c| c.is_alphanumeric()).unwrap_or('•').to_uppercase().to_string()).font(k.ty.small_medium).color(Color::WHITE)),
    };
    let name = app.to_owned();
    let hide = rule.hide;
    let head = row()
        .key("head")
        .w_full()
        .gap(10.0)
        .center_y()
        .child(mark)
        .child(text(app.to_owned()).key("name").font(k.ty.ui_medium).color(if hide { c.text_faint } else { c.text_base }).grow(1.0).shrink().truncate())
        .child(text(if hide { "Muted" } else { "Show" }).key("state").font(k.ty.small).color(c.text_muted))
        .child(Switch::new(!hide).hide_label().on_toggle(move |s: &mut Ui| s.set_app(name.clone(), "hide", (!hide).then(Vec::new))).build(k));
    let mut body = col().key(format!("app-{i}")).w_full().px(12.0).py(10.0).gap(10.0).child(head);
    if !hide {
        let stay = match rule.stay {
            None => 0,
            Some(s) if s <= 0.0 => u32::MAX,
            Some(s) => s.round() as u32,
        };
        let name = app.to_owned();
        body = body.child(
            row().key("stay").w_full().gap(10.0).center_y().pl(32.0).child(text("Stay").key("label").font(k.ty.small).color(c.text_muted).w(64.0)).child(choice(
                k,
                "stay-control",
                APP_STAY,
                Some(if APP_STAY.iter().any(|o| o.0 == stay) { stay } else { 0 }),
                330.0,
                move |s, v| {
                    let value = match v {
                        0 => None,
                        u32::MAX => Some(vec![Value::Text("never".into())]),
                        n => Some(vec![Value::Number(n as f64)]),
                    };
                    s.set_app(name.clone(), "timeout", value)
                },
            )),
        );
        let name = app.to_owned();
        let interrupt = rule.interrupt;
        body = body.child(
            row()
                .key("interrupt")
                .w_full()
                .gap(10.0)
                .center_y()
                .pl(32.0)
                .child(text("Show during Do not disturb").key("label").font(k.ty.small).color(c.text_muted).grow(1.0).shrink())
                .child(Switch::new(interrupt).hide_label().on_toggle(move |s: &mut Ui| s.set_app(name.clone(), "interrupt", (!interrupt).then(Vec::new))).build(k)),
        );
    }
    body
}

fn apps(s: &Ui, k: &Kit) -> El {
    let c = &k.c;
    let (rules, custom) = crate::config::app_rules(&s.loaded.own);
    let mut rows: Vec<El> = s
        .apps
        .iter()
        .enumerate()
        .map(|(i, app)| {
            let rule = rules.iter().find(|(a, _)| a.eq_ignore_ascii_case(app)).map(|(_, r)| r.clone()).unwrap_or_default();
            app_row(s, k, i, app, &rule)
        })
        .collect();
    if rows.is_empty() {
        rows.push(text("Apps show up here once they've sent a notification.").key("empty").font(k.ty.small).color(c.text_muted).px(12.0).py(12.0));
    }
    if custom > 0 {
        rows.push(
            row()
                .key("custom")
                .w_full()
                .px(12.0)
                .py(8.0)
                .gap(10.0)
                .center_y()
                .child(
                    text(format!("{custom} more rule{} in config.kdl match by text or urgency", if custom == 1 { "" } else { "s" }))
                        .key("line")
                        .font(k.ty.small)
                        .color(c.text_muted)
                        .grow(1.0)
                        .shrink()
                        .w(0.0),
                )
                .child(button(k, "edit-rules", "Edit config.kdl", |s| s.edit_config())),
        );
    }
    section(k, "apps", heading(k, "Apps"), rows)
}

fn sidebar(s: &Ui, k: &Kit) -> El {
    let c = &k.c;
    let mut content = col()
        .key("content")
        .w_full()
        .px(24.0)
        .pt(24.0)
        .pb(32.0)
        .gap(24.0)
        .child(
            col()
                .key("title")
                .gap(4.0)
                .child(text("Hokum").key("name").font(rune::TextStyle { size: 20.0, ..k.ty.ui_medium }.lh(24.0)).color(c.text_base))
                .child(status(k, s)),
        );
    if let Some(e) = &s.error {
        content = content.child(text(e.clone()).key("error").font(k.ty.small).color(c.danger.fg).wrap().w_full());
    }
    content = content.child(themes(s, k)).child(own_theme(s, k)).child(behaviour(s, k)).child(apps(s, k));
    col().key("sidebar").w(SIDEBAR).h_full().fill(c.page).scroll(ScrollSpec { stick_bottom: false }).clip_fade(0.0, 0.0, 0.0, 16.0).child(content)
}

fn preview(s: &Ui, k: &Kit, window: &Kit) -> El {
    let backdrop = if k.dark {
        (rune::oklch(0.32, 0.06, 265.0), rune::oklch(0.22, 0.05, 300.0))
    } else {
        (rune::oklch(0.86, 0.05, 230.0), rune::oklch(0.78, 0.07, 290.0))
    };
    col()
        .key("preview")
        .grow(1.0)
        .h_full()
        .padding(16.0)
        .gap(10.0)
        .fill(window.c.bg_deep)
        .child(text("Preview").key("label").font(window.ty.small_medium).color(window.c.text_faint).ml(4.0))
        .child(
            el().key("screen")
                .w_full()
                .grow(1.0)
                .radius(14.0)
                .gradient(backdrop.0, backdrop.1)
                .clip_soft(0.0)
                .child(stack::<Ui>(&s.samples, &s.loaded.behaviour, &s.loaded.theme, k, None)),
        )
}

fn view(s: &Ui, cx: &mut Cx<Ui>) -> El {
    let (window, preview_kit) = kit(s, cx);
    row().key("window").w_full().h_full().fill(window.c.page).child(sidebar(s, window)).child(preview(s, preview_kit, window))
}

fn tile_note() -> Note {
    let mut n = samples().remove(0);
    n.actions.clear();
    n.body = "ship it before anyone sees the mako ones 👋".into();
    n
}

pub fn init() -> Ui {
    let mut ui = Ui {
        loaded: crate::config::load(),
        daemon: Daemon::Checking,
        overlay: None,
        bus: None,
        handle: None,
        sent: 0,
        error: None,
        script: ScriptStatus::None,
        copied: false,
        gallery: Vec::new(),
        apps: Vec::new(),
        icons: HashMap::new(),
        samples: samples(),
        tile_note: tile_note(),
        cache: None,
    };
    ui.configure(crate::watch::load());
    ui
}

/// A path with the home folder as `~`.
fn home(p: &std::path::Path) -> String {
    match std::env::var_os("HOME").and_then(|h| p.strip_prefix(h).ok().map(|r| r.display().to_string())) {
        Some(rest) => format!("~/{rest}"),
        None => p.display().to_string(),
    }
}

/// Opens a file or folder in the desktop's handler for it.
fn open(path: &std::path::Path) {
    let _ = std::process::Command::new("xdg-open").arg(path).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn();
}

fn decode(s: &mut Ui, cache: rune::ImageCache, wait: bool) {
    for n in s.samples.iter_mut().chain(std::iter::once(&mut s.tile_note)) {
        n.decode(&cache);
        if wait {
            for img in n.icon.iter().chain(&n.image) {
                let _ = img.wait();
            }
        }
    }
    s.cache = Some(cache);
    s.decode_icons();
    if wait {
        for img in s.icons.values().flatten() {
            let _ = img.wait();
        }
    }
}

/// Decodes everything now (headless renders have no event loop to finish decodes).
fn decode_now(s: &mut Ui) {
    decode(s, rune::ImageCache::new(std::sync::Arc::new(|| {})), true);
}

fn scene_hokum(s: &mut Ui) {
    s.daemon = Daemon::Hokum;
    decode_now(s);
}

fn scene_other(s: &mut Ui) {
    s.daemon = Daemon::Other("mako".into());
    decode_now(s);
}

fn setup(s: &mut Ui, waker: rune::Waker) {
    decode(s, rune::ImageCache::new(waker), false);
}

pub fn spec() -> AppSpec<Ui> {
    AppSpec {
        scenes: &[("hokum", scene_hokum), ("other", scene_other)],
        fonts: rune_theme_opencode::FONTS,
        families: rune_theme_opencode::FAMILIES,
        setup: Some(setup),
        ..AppSpec::new("Hokum", SIZE, init, view)
    }
}

/// Fixed-size, like Hex's window: tiling compositors open it floating.
pub fn window() -> WindowOptions {
    WindowOptions { min_size: Some(SIZE), max_size: Some(SIZE), resizable: false, ..WindowOptions::default() }
}

//! The settings window, hosted by the running service beside the overlay (like Hex's). Every
//! change saves the settings file and restyles the overlay in the same process; the preview on
//! the right draws the same cards with the same code.

use rune::{AppSpec, Color, Cursor, Cx, El, OverlayHandle, ScrollSpec, Tx, WindowOptions, col, el, row, text};
use rune_kit::{Button, ButtonVariant, ControlSize, Kit, SegmentedControl, Switch};
use zbus::blocking::Connection;

use crate::card::{Cards, Note, samples, tint};
use crate::cards::stack;
use crate::theme::{Problem, Theme};
use crate::watch::Config;
use crate::style::{Appearance, Corners, Density, Depth, Linger, Mark, PRESETS, Position, Settings, Style, Width};

const SIDEBAR: f32 = 540.0;
pub const SIZE: (f32, f32) = (1080.0, 760.0);

/// Whether this process answers `org.freedesktop.Notifications`.
#[derive(Clone, PartialEq, Debug)]
pub enum Daemon {
    Checking,
    Hokum,
    Other(String),
}

pub struct Ui {
    settings: Settings,
    pub daemon: Daemon,
    pub overlay: Option<OverlayHandle<crate::cards::Ui>>,
    pub bus: Option<Connection>,
    pub handle: Option<rune::AppHandle<Ui>>,
    sent: u32,
    error: Option<String>,
    theme: Theme,
    /// What's wrong with the chosen theme file, if anything (the overlay keeps the last good one).
    problems: Vec<Problem>,
    /// Bundled themes and files in the themes folder: (id, name).
    themes: Vec<(String, String)>,
    script: ScriptStatus,
    /// The preview's cards, with icons decoded by `cache`.
    samples: Vec<Note>,
    cache: Option<rune::ImageCache>,
}

#[derive(Clone, PartialEq, Debug)]
enum ScriptStatus {
    None,
    Loaded,
    Broken(String),
}

impl Cards for Ui {
    fn dismiss(&mut self, _: u32) {}
    fn invoke(&mut self, _: u32, _: &str) {}
    fn activate(&mut self, _: u32) {}
    fn hover(&mut self, _: bool) {}
}

impl Ui {
    fn change(&mut self, f: impl FnOnce(&mut Settings)) {
        let before = self.settings.clone();
        f(&mut self.settings);
        if self.settings == before {
            return;
        }
        self.error = self.settings.save().err().map(|e| format!("Couldn't save settings: {e}"));
        if self.settings.theme != before.theme {
            self.load_theme();
        }
        if let Some(o) = &self.overlay {
            let settings = self.settings.clone();
            let theme = self.problems.is_empty().then(|| self.theme.clone());
            o.update(move |c, _| {
                if let Some(t) = theme {
                    c.theme = t;
                }
                c.apply(settings);
            });
        }
    }

    fn load_theme(&mut self) {
        match crate::theme::load(&self.settings.theme) {
            Ok(t) => {
                self.theme = t;
                self.problems.clear();
            }
            Err(p) => self.problems = p,
        }
    }

    /// Settings, theme and script from files (at startup, and whenever they change on disk).
    pub fn configure(&mut self, config: Config) {
        self.settings = config.settings;
        match config.theme {
            Ok(t) => {
                self.theme = t;
                self.problems.clear();
            }
            Err(p) => self.problems = p,
        }
        self.themes = crate::theme::available();
        self.script = match config.script.as_deref().map(crate::script::Script::compile) {
            None => ScriptStatus::None,
            Some(Ok(_)) => ScriptStatus::Loaded,
            Some(Err(e)) => ScriptStatus::Broken(e),
        };
    }

    /// A new theme file from the current look, chosen and opened in the editor.
    fn new_theme(&mut self) {
        let dir = crate::theme::dir();
        let path = (1..).map(|i| dir.join(if i == 1 { "my-theme.kdl".into() } else { format!("my-theme-{i}.kdl") })).find(|p| !p.exists()).unwrap();
        let written = std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&path, starter(&self.settings.style)));
        match written {
            Ok(()) => {
                let id = path.display().to_string();
                self.themes = crate::theme::available();
                self.change(|s| s.theme = id);
                open(&path);
            }
            Err(e) => self.error = Some(format!("Couldn't write {}: {e}", path.display())),
        }
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
    let preview = match s.settings.appearance {
        Appearance::System => window,
        Appearance::Light => rune_theme_opencode::kit(false),
        Appearance::Dark => rune_theme_opencode::kit(true),
    };
    (window, preview)
}

fn section(k: &Kit, key: &str, title: &str, rows: Vec<El>) -> El {
    let c = &k.c;
    let n = rows.len();
    let mut card = col().key("card").padding(4.0).radius(12.0).fill(c.bg_base).border(1.0, c.border_muted);
    for (i, r) in rows.into_iter().enumerate() {
        card = card.child(r);
        if i + 1 < n {
            card = card.child(el().key(format!("sep{i}")).h(1.0).ml(12.0).mr(12.0).fill(c.border_muted));
        }
    }
    col()
        .key(key)
        .gap(8.0)
        .child(text(title).key("header").font(k.ty.ui_medium.lh(16.0)).color(c.text_muted).ml(12.0))
        .child(card)
}

fn setting(k: &Kit, key: &str, title: &str, description: Option<&str>, control: El) -> El {
    let c = &k.c;
    let mut copy = col().key("copy").grow(1.0).shrink().gap(2.0).child(text(title).key("title").font(k.ty.ui).color(c.text_base));
    if let Some(d) = description {
        copy = copy.child(text(d).key("description").font(k.ty.small).color(c.text_muted).wrap().w_full());
    }
    row()
        .key(key)
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

fn toggle(k: &Kit, key: &str, title: &str, description: Option<&str>, on: bool, f: fn(&mut Settings)) -> El {
    let c = &k.c;
    setting(k, key, title, description, Switch::new(on).hide_label().on_toggle(move |s: &mut Ui| s.change(f)).build(k))
        .radius(8.0)
        .hover(c.hover)
        .cursor(Cursor::Pointer)
        .on_press(move |s: &mut Ui| s.change(f))
}

fn choice<T: Copy + PartialEq + 'static>(
    k: &Kit,
    key: &str,
    options: &'static [(T, &'static str)],
    current: T,
    width: f32,
    set: fn(&mut Settings, T),
) -> El {
    let labels: Vec<&str> = options.iter().map(|o| o.1).collect();
    let i = options.iter().position(|o| o.0 == current);
    SegmentedControl::new(&labels, i)
        .width(Some(width))
        .on_pick(move |s: &mut Ui, i: usize, _: &mut Tx| s.change(|st| set(st, options[i].0)))
        .build(k)
        .key(key.to_owned())
}

/// A miniature card for one preset: its corners, border, depth and mark at a glance.
fn preset_tile(k: &Kit, i: usize, name: &'static str, style: &Style, selected: bool) -> El {
    let c = &k.c;
    let accent = tint(["Slack", "Linear", "GitHub", "Figma"][i]);
    let r = style.radius() * 0.55;
    let line = |key: &str, w: f32, color: Color| el().key(key.to_owned()).w_frac(w).h(5.0).radius(2.5).fill(color);
    let mut head = row().key("head").w_full().gap(5.0).center_y();
    match style.mark {
        Mark::Letter | Mark::Icon => head = head.child(el().key("badge").size(11.0, 11.0).radius(style.badge_radius() * 0.55).fill(accent)),
        Mark::Dot => head = head.child(el().key("dot").size(6.0, 6.0).radius(3.0).fill(accent)),
        _ => {}
    }
    head = head.child(line("app", 0.45, c.text_faint));
    let lines = col()
        .key("lines")
        .grow(1.0)
        .shrink()
        .w(0.0)
        .gap(5.0)
        .child(head)
        .child(line("title", 0.8, c.text_muted))
        .child(line("body", 0.6, c.text_faint));
    let mut mini = row().key("mini").w_full().padding(8.0).gap(6.0).items_stretch().radius(r).fill(c.layer_01);
    if style.mark == Mark::Stripe {
        mini = mini.pl(6.0).child(el().key("stripe").w(2.0).radius(1.0).fill(accent));
    }
    let mut mini = mini.child(lines);
    if style.border {
        mini = mini.border(1.0, c.border_muted);
    }
    if style.depth != Depth::Flat {
        for sh in &k.elevation.overlay {
            mini = mini.box_shadow(*sh);
        }
    }
    let preset = *style;
    col()
        .key(format!("preset-{i}"))
        .role("radio")
        .label(name)
        .grow(1.0)
        .w(0.0)
        .padding(8.0)
        .gap(8.0)
        .radius(12.0)
        .fill(if selected { c.layer_02 } else { Color::TRANSPARENT })
        .border(1.0, if selected { c.border_strong } else { Color::TRANSPARENT })
        .hover(c.hover)
        .press(c.pressed)
        .cursor(Cursor::Pointer)
        .on_press(move |s: &mut Ui| s.change(|st| st.style = preset))
        .child(el().key("stage").w_full().h(64.0).radius(8.0).fill(c.bg_deep).center().px(10.0).child(mini))
        .child(text(name).key("name").font(k.ty.small_medium).color(if selected { c.text_base } else { c.text_muted }).self_center())
}

/// A tiny screen with a target in each corner.
fn corner_picker(k: &Kit, current: Position) -> El {
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
                .on_press(move |s: &mut Ui| s.change(|st| st.position = p)),
        );
    }
    screen
}

const CORNERS: &[(Corners, &str)] =
    &[(Corners::Sharp, "Sharp"), (Corners::Rounded, "Rounded"), (Corners::Soft, "Soft"), (Corners::Round, "Pill")];
const DENSITY: &[(Density, &str)] = &[(Density::Compact, "Compact"), (Density::Comfortable, "Cozy"), (Density::Spacious, "Roomy")];
const MARKS: &[(Mark, &str)] =
    &[(Mark::Icon, "Icon"), (Mark::Letter, "Letter"), (Mark::Dot, "Dot"), (Mark::Stripe, "Stripe"), (Mark::None, "None")];
const DEPTH: &[(Depth, &str)] = &[(Depth::Flat, "Flat"), (Depth::Soft, "Soft"), (Depth::Deep, "Deep")];
const WIDTH: &[(Width, &str)] = &[(Width::Narrow, "Narrow"), (Width::Medium, "Medium"), (Width::Wide, "Wide")];
const LINGER: &[(Linger, &str)] = &[(Linger::Short, "4 s"), (Linger::Medium, "6 s"), (Linger::Long, "10 s")];
const SHOWN: &[(usize, &str)] = &[(3, "3"), (5, "5"), (8, "8")];
const THEMES: &[(Appearance, &str)] = &[(Appearance::System, "System"), (Appearance::Light, "Light"), (Appearance::Dark, "Dark")];

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
    r.child(
        Button::new("Send test")
            .variant(ButtonVariant::Ghost)
            .control_size(ControlSize::Regular)
            .on_press(|s: &mut Ui| s.test())
            .build(k)
            .key("test"),
    )
}

fn sidebar(s: &Ui, k: &Kit) -> El {
    let c = &k.c;
    let st = &s.settings;
    let preset = st.preset();
    let tiles = PRESETS.iter().enumerate().map(|(i, (name, style))| preset_tile(k, i, name, style, preset == Some(i)));
    let looks = section(
        k,
        "style",
        if preset.is_some() { "Style" } else { "Style · Custom" },
        vec![
            row().key("presets").w_full().padding(8.0).gap(6.0).children(tiles),
            setting(k, "corners", "Corners", None, choice(k, "corners-control", CORNERS, st.style.corners, 340.0, |s, v| s.style.corners = v)),
            setting(k, "density", "Density", None, choice(k, "density-control", DENSITY, st.style.density, 340.0, |s, v| s.style.density = v)),
            setting(k, "mark", "App mark", Some("How a card shows who sent it"), choice(k, "mark-control", MARKS, st.style.mark, 340.0, |s, v| s.style.mark = v)),
            setting(k, "depth", "Shadow", None, choice(k, "depth-control", DEPTH, st.style.depth, 340.0, |s, v| s.style.depth = v)),
            setting(k, "width", "Width", None, choice(k, "width-control", WIDTH, st.style.width, 340.0, |s, v| s.style.width = v)),
            toggle(k, "border", "Border", None, st.style.border, |s| s.style.border = !s.style.border),
            setting(k, "theme", "Appearance", None, choice(k, "theme-control", THEMES, st.appearance, 340.0, |s, v| s.appearance = v)),
        ],
    );
    let behaviour = section(
        k,
        "behaviour",
        "Behaviour",
        vec![
            setting(k, "position", "Position", Some("The corner of the focused screen"), corner_picker(k, st.position)),
            setting(k, "linger", "Stay for", Some("When the app doesn't say. Critical ones stay until dismissed"), choice(k, "linger-control", LINGER, st.linger, 180.0, |s, v| s.linger = v)),
            setting(k, "shown", "Show at most", None, choice(k, "shown-control", SHOWN, st.max_shown, 180.0, |s, v| s.max_shown = v)),
            toggle(k, "pause", "Pause while hovered", Some("Timers wait while the pointer is over a card"), st.pause_on_hover, |s| s.pause_on_hover = !s.pause_on_hover),
            toggle(k, "dnd", "Do not disturb", Some("Only critical notifications show"), st.do_not_disturb, |s| s.do_not_disturb = !s.do_not_disturb),
        ],
    );
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
    content = content.child(themes(s, k)).child(looks).child(behaviour);
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
                .child(stack::<Ui>(&s.samples, &s.settings, &s.theme, k, None)),
        )
}

fn view(s: &Ui, cx: &mut Cx<Ui>) -> El {
    let (window, preview_kit) = kit(s, cx);
    row().key("window").w_full().h_full().fill(window.c.page).child(sidebar(s, window)).child(preview(s, preview_kit, window))
}

pub fn init() -> Ui {
    let mut ui = Ui {
        settings: Settings::default(),
        daemon: Daemon::Checking,
        overlay: None,
        bus: None,
        handle: None,
        sent: 0,
        error: None,
        theme: Theme::builtin(),
        problems: Vec::new(),
        themes: Vec::new(),
        script: ScriptStatus::None,
        samples: samples(),
        cache: None,
    };
    ui.configure(crate::watch::load());
    ui
}

/// Opens a file or folder in the desktop's handler for it.
fn open(path: &std::path::Path) {
    let _ = std::process::Command::new("xdg-open").arg(path).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn();
}

/// A new theme: today's style written out as tokens, and the built-in card to change.
fn starter(style: &Style) -> String {
    let t = crate::theme::Tokens::from_style(style);
    let mark = format!("{:?}", t.mark).to_lowercase();
    let shadow = format!("{:?}", t.shadow).to_lowercase();
    let border = match t.border {
        Some(_) => "border 1 \"border\"".to_owned(),
        None => "border \"none\"".to_owned(),
    };
    format!(
        r##"// A Hokum theme. Save and it applies; problems show in Hokum's settings window.
// Reference: https://github.com/anomalyco/hokum/blob/main/docs/theming.md
theme "My theme"

// Every token, at what your style controls set now. Delete any to keep the controls' value.
// Colours: "#rrggbb", "#rrggbbaa", or a palette name that follows light and dark:
// layer layer-2 layer-3 page base deep text muted faint border border-strong hover
// accent (the app's colour) danger warning success info white black transparent,
// optionally at an opacity: "accent/30".
tokens {{
    width {width}
    radius {radius}
    padding {pad}
    gap {gap}
    spacing {spacing}
    badge-radius {badge}
    icon-size {icon}
    font "sans"
    font-size {font}
    title-weight {title}
    fill "layer"
    text "text"
    muted "muted"
    faint "faint"
    {border}
    accent "app"
    shadow "{shadow}"
    mark "{mark}"
    enter "slide"
    motion {d} {b}
}}

// Override tokens for one appearance:
// tokens "dark" {{ fill "#101014" }}
// tokens "light" {{ fill "#ffffff" }}

// The built-in card's layout. Fields: {fields}.
{template}
// Rules match notifications (app, summary, body: case-insensitive, * wildcards; urgency)
// and pick a template, change tokens, change the timeout (seconds or "never"), or hide.
// rule app="Slack" {{ tokens {{ accent "#d38be0" }} }}
// rule app="Spotify" {{ hide }}
// rule urgency="critical" {{ timeout "never" }}
"##,
        width = t.width,
        radius = t.radius,
        pad = t.padding[0],
        gap = t.gap,
        spacing = t.spacing,
        badge = t.badge_radius,
        icon = t.icon_size,
        font = t.font_size,
        title = t.title_weight,
        d = t.motion.0,
        b = t.motion.1,
        fields = crate::theme::FIELDS.join(", "),
        template = crate::theme::DEFAULT.lines().filter(|l| !l.starts_with("//")).collect::<Vec<_>>().join("\n").trim(),
    )
}

/// The theme chooser, theme problems, and the script's state.
fn themes(s: &Ui, k: &Kit) -> El {
    let c = &k.c;
    let chip = |i: usize, id: String, name: String| {
        let on = s.settings.theme == id;
        row()
            .key(format!("theme-{i}"))
            .role("radio")
            .label(name.clone())
            .h(30.0)
            .px(12.0)
            .center_y()
            .radius(8.0)
            .fill(if on { c.layer_02 } else { Color::TRANSPARENT })
            .border(1.0, if on { c.border_strong } else { c.border_muted })
            .hover(c.hover)
            .press(c.pressed)
            .cursor(Cursor::Pointer)
            .on_press(move |s: &mut Ui| {
                let id = id.clone();
                s.change(|st| st.theme = id)
            })
            .child(text(name).key("name").font(k.ty.ui).color(if on { c.text_base } else { c.text_muted }))
    };
    let all = std::iter::once((String::new(), "None".to_owned())).chain(s.themes.iter().cloned());
    let chips = row().key("chips").w_full().gap(6.0).flex_wrap().children(all.enumerate().map(|(i, (id, name))| chip(i, id, name)));
    let button = |key: &str, label: &str, f: fn(&mut Ui)| {
        Button::new(label).variant(ButtonVariant::Ghost).control_size(ControlSize::Regular).on_press(f).build(k).key(key.to_owned())
    };
    let mut top = col()
        .key("theme-pick")
        .w_full()
        .padding(12.0)
        .gap(10.0)
        .child(
            text("A theme can change any token, lay cards out with templates, and route notifications with rules. It sits on top of the style below.")
                .key("about")
                .font(k.ty.small)
                .color(c.text_muted)
                .wrap()
                .w_full(),
        )
        .child(chips)
        .child(
            row()
                .key("theme-actions")
                .gap(4.0)
                .child(button("new-theme", "New theme", |s| s.new_theme()))
                .child(button("open-themes", "Open folder", |_| {
                    let dir = crate::theme::dir();
                    let _ = std::fs::create_dir_all(&dir);
                    open(&dir);
                })),
        );
    for (i, p) in s.problems.iter().take(6).enumerate() {
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
        .child(button("edit-script", if s.script == ScriptStatus::None { "Create script" } else { "Edit script" }, |s| s.edit_script()));
    section(k, "themes", "Theme", vec![top, script])
}

/// Decodes the preview's icons now (headless renders have no event loop to finish them).
fn decode_now(s: &mut Ui) {
    let cache = rune::ImageCache::new(std::sync::Arc::new(|| {}));
    for n in &mut s.samples {
        n.decode(&cache);
        for img in n.icon.iter().chain(&n.image) {
            let _ = img.wait();
        }
    }
    s.cache = Some(cache);
}

fn scene_custom(s: &mut Ui) {
    s.daemon = Daemon::Hokum;
    s.settings.style.corners = Corners::Round;
    s.settings.position = Position::BottomLeft;
    decode_now(s);
}

fn scene_hokum(s: &mut Ui) {
    s.daemon = Daemon::Hokum;
    decode_now(s);
}

fn scene_other(s: &mut Ui) {
    s.daemon = Daemon::Other("mako".into());
    decode_now(s);
}

fn scene_neon(s: &mut Ui) {
    s.daemon = Daemon::Hokum;
    s.settings.theme = "neon".into();
    s.load_theme();
    decode_now(s);
}

fn setup(s: &mut Ui, waker: rune::Waker) {
    let cache = rune::ImageCache::new(waker);
    for n in &mut s.samples {
        n.decode(&cache);
    }
    s.cache = Some(cache);
}

pub fn spec() -> AppSpec<Ui> {
    AppSpec {
        scenes: &[("hokum", scene_hokum), ("other", scene_other), ("custom", scene_custom), ("neon", scene_neon)],
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

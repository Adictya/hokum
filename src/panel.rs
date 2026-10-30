//! The tray panel: a click on Hokum's tray icon opens the modules' first screens, compact.
//! The output's volume and device, the input while something records (or it's muted), the
//! Bluetooth devices (a click connects or disconnects), Do not disturb, and a way into the
//! window. `hokum panel sound|bt` opens it on one module's part. It covers the screen, clear,
//! so a click anywhere outside the card closes it (layer surfaces only learn of focus moving
//! away once they've had it, which a pointer-only panel never does). On Hyprland the card opens
//! under the pointer, which is on the bar icon that opened it, and it closes once the pointer
//! leaves it, or never comes.

use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::sync::atomic::Ordering;
use std::time::Duration;

use rune::{Cursor, El, KeyPolicy, OverlayInput, OverlayOptions, OverlayPlacement, OverlaySpec, col, el, row, text};
use rune_kit::{ControlSize, IconButton, IconButtonVariant, Kit, Switch};

use crate::settings::{Section, Surface, Ui};

/// The card's width.
pub const WIDTH: f32 = 340.0;
/// Room around the card for its shadow.
pub const MARGIN: f32 = 12.0;
/// Tall enough for the card with a row open.
const HEIGHT: f32 = 720.0;
/// From the screen's top and right edges, under the bar the tray sits in.
const OFFSET: f32 = 4.0;
/// How long the pointer may stay off the card before it closes.
const LEAVE: Duration = Duration::from_millis(400);
/// How long the pointer has to reach the card after it opens.
pub const GRACE: Duration = Duration::from_millis(1500);

static BELL: rune::Icon = rune::Icon {
    name: "bell",
    view: 16.0,
    body: r#"<path d="M4.5 10.5V7a3.5 3.5 0 0 1 7 0v3.5l1 1.5h-9l1-1.5Z" stroke="currentColor" stroke-linejoin="round"/><path d="M6.5 14h3" stroke="currentColor"/>"#,
};

fn rule(k: &Kit, key: &str) -> El {
    el().key(key.to_owned()).h(1.0).mx(14.0).fill(k.c.border_muted)
}

/// Do not disturb, and the window.
fn footer(s: &Ui, k: &Kit) -> El {
    let c = &k.c;
    let dnd = s.loaded.behaviour.do_not_disturb;
    let toggle = |s: &mut Ui| {
        if let Some(w) = &s.handle {
            w.update(|w, _| w.toggle_dnd());
        }
    };
    let open = IconButton::new(&crate::sound::ui::glyphs::EXPAND)
        .variant(IconButtonVariant::GhostMuted)
        .label("Open Hokum")
        .on_press(|s: &mut Ui| {
            if let Some(w) = &s.handle {
                crate::modules::open(w, None, None);
            }
            if let Some(d) = &s.dismiss {
                d();
            }
        })
        .build(k)
        .key("open-window");
    let switch = Switch::new(dnd).label("Do not disturb").hide_label().control_size(ControlSize::Small).on_toggle(toggle).build(k).key("dnd-switch");
    row()
        .key("footer")
        .w_full()
        .h(44.0)
        .pl(8.0)
        .pr(6.0)
        .gap(6.0)
        .center_y()
        .child(
            row()
                .key("dnd")
                .role("switch")
                .label("Do not disturb")
                .grow(1.0)
                .h(32.0)
                .pl(6.0)
                .pr(6.0)
                .gap(10.0)
                .radius(8.0)
                .center_y()
                .hover(c.hover)
                .cursor(Cursor::Pointer)
                .on_press(toggle)
                .child(rune::icon(&BELL, 16.0).key("glyph").color(if dnd { c.icon_base } else { c.icon_muted }))
                .child(text("Do not disturb").key("label").font(k.ty.ui).color(c.text_base).grow(1.0))
                .child(switch),
        )
        .child(open.opacity(0.7))
}

pub fn view(s: &Ui, k: &Kit) -> El {
    let c = &k.c;
    let mut layer = Vec::new();
    let mut card = col().key("panel").w_full();
    let mut parts = 0;
    let shows = |m: Section| s.only.is_none_or(|o| o == m);
    if s.loaded.modules.sound && s.sound_error.is_none() && shows(Section::Sound) {
        let rows = crate::sound::ui::panel(&s.sound, k, &mut layer);
        if !rows.is_empty() {
            card = card.child(col().key("sound").w_full().px(14.0).pt(12.0).pb(14.0).gap(14.0).children(rows));
            parts += 1;
        }
    }
    if s.loaded.modules.bluetooth && s.bluetooth_error.is_none() && shows(Section::Bluetooth) {
        let rows = crate::bluetooth::ui::panel(&s.bluetooth, k);
        if !rows.is_empty() {
            if parts > 0 {
                card = card.child(rule(k, "rule-bluetooth"));
            }
            card = card.child(col().key("bluetooth").w_full().padding(6.0).children(rows));
            parts += 1;
        }
    }
    if parts > 0 {
        card = card.child(rule(k, "rule-footer"));
    }
    let card = card.child(footer(s, k)).radius(14.0).fill(c.page).border(1.0, c.border_base).hit();
    let card = k.elevation.overlay.iter().fold(card, |e, sh| e.box_shadow(*sh));
    let width = WIDTH + 2.0 * MARGIN;
    let frame = match s.panel_at {
        Some((x, area)) => col().pin(Some((x - width / 2.0).clamp(OFFSET, (area - width - OFFSET).max(OFFSET))), Some(OFFSET), None, None),
        None => col().pin(None, Some(OFFSET), Some(OFFSET), None),
    };
    let frame = frame
        .key(format!("panel-frame-{}", s.opened))
        .hover_delays(Duration::ZERO, LEAVE)
        .on_hover_change(|s: &mut Ui, inside, _| {
            if inside {
                s.entered.store(true, Ordering::SeqCst);
            } else if let Some(d) = &s.dismiss {
                d();
            }
        })
        .w(width)
        .padding(MARGIN)
        .child(card)
        .children(layer.into_iter().map(El::hit));
    let backdrop = el().key("backdrop").pin(Some(0.0), Some(0.0), Some(0.0), Some(0.0)).hit().on_press(|s: &mut Ui| {
        if let Some(d) = &s.dismiss {
            d();
        }
    });
    el().key("panel-root").w_full().h_full().child(backdrop).child(frame)
}

/// The pointer's x in the area a full-screen layer surface gets on the output under it (the
/// output less what bars reserve), and that area's width, from Hyprland's socket. None
/// elsewhere, and the panel takes the corner.
pub fn pointer() -> Option<(f32, f32)> {
    let ask = |cmd: &str| -> Option<serde_json::Value> {
        let dir = std::path::PathBuf::from(std::env::var_os("XDG_RUNTIME_DIR")?);
        let path = dir.join("hypr").join(std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE")?).join(".socket.sock");
        let mut socket = UnixStream::connect(path).ok()?;
        socket.set_read_timeout(Some(Duration::from_millis(500))).ok()?;
        socket.write_all(cmd.as_bytes()).ok()?;
        let mut out = Vec::new();
        socket.read_to_end(&mut out).ok()?;
        serde_json::from_slice(&out).ok()
    };
    let cursor = ask("j/cursorpos")?;
    let (x, y) = (cursor["x"].as_f64()?, cursor["y"].as_f64()?);
    ask("j/monitors")?.as_array()?.iter().find_map(|m| area(m, x, y))
}

/// `pointer` for one monitor from `hyprctl monitors -j`: None when the pointer is elsewhere.
fn area(m: &serde_json::Value, x: f64, y: f64) -> Option<(f32, f32)> {
    let num = |k: &str| m[k].as_f64();
    let scale = num("scale").filter(|s| *s > 0.0)?;
    // Pixels, before scale and rotation; the position is already in logical points.
    let (mut w, mut h) = (num("width")? / scale, num("height")? / scale);
    if m["transform"].as_i64().unwrap_or(0) % 2 == 1 {
        std::mem::swap(&mut w, &mut h);
    }
    let (mx, my) = (num("x")?, num("y")?);
    if x < mx || y < my || x >= mx + w || y >= my + h {
        return None;
    }
    let reserved = |i: usize| m["reserved"][i].as_f64().unwrap_or(0.0);
    Some(((x - mx - reserved(0)) as f32, (w - reserved(0) - reserved(2)) as f32))
}

/// The panel's overlay: the whole screen, with the card under the top edge at the right, where
/// tray icons usually sit.
pub fn overlay() -> rune::ConfiguredOverlay<Ui> {
    OverlaySpec::new("hokum-panel", (WIDTH + 2.0 * MARGIN, HEIGHT), crate::settings::view)
        .options(OverlayOptions {
            placement: Some(OverlayPlacement::FullScreen),
            keys: KeyPolicy::OnDemand,
            input: OverlayInput::Regions,
            ..OverlayOptions::default()
        })
        .on_key(crate::settings::on_key)
        .on_focus(|s: &mut Ui, focused, _| {
            if !focused
                && s.sound.visible
                && let Some(d) = &s.dismiss
            {
                d();
            }
        })
        .setup(crate::settings::setup)
}

/// The panel's state: the window's, drawn as the panel.
pub fn state(window: rune::AppHandle<Ui>) -> Ui {
    let mut ui = crate::settings::init();
    ui.surface = Surface::Panel;
    ui.sound.mode = crate::sound::ui::Mode::Popover;
    ui.bluetooth.mode = crate::bluetooth::ui::Mode::Popover;
    ui.hidden();
    ui.handle = Some(window);
    ui
}

#[cfg(test)]
mod tests {
    use super::area;

    #[test]
    fn the_pointer_lands_in_its_monitors_area_past_the_bars() {
        let m = serde_json::json!({ "x": 1920, "y": 0, "width": 3840, "height": 2160, "scale": 1.25, "transform": 0, "reserved": [10, 32, 0, 0] });
        assert_eq!(area(&m, 4493.0, 10.0), Some((2563.0, 3062.0)));
        assert_eq!(area(&m, 100.0, 10.0), None);
        let turned = serde_json::json!({ "x": 0, "y": 0, "width": 1920, "height": 1080, "scale": 1, "transform": 1, "reserved": [0, 0, 0, 0] });
        assert_eq!(area(&turned, 500.0, 1500.0), Some((500.0, 1080.0)));
    }
}

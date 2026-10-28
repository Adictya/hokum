//! Hokum (hokum.app): a freedesktop notification daemon drawn with Rune.
//!
//! ```sh
//! hokum                     # show the settings window (starting Hokum if it isn't running)
//! hokum service [--replace] # run Hokum in the background (what hokum.service starts)
//! hokum --version
//! hokum --snap /tmp/settings.png --scene hokum            # headless settings, no D-Bus
//! hokum service --snap /tmp/cards.png --scene demo        # headless cards, no D-Bus
//! ```
//!
//! One process, like Hex: the service owns `org.freedesktop.Notifications`, draws the cards on
//! an overlay (a click-through layer surface on Wayland) and hosts the settings window. A
//! second `hokum` asks it to show that window over D-Bus and exits.

mod adjust;
mod apps;
mod bus;
mod card;
mod cards;
mod config;
mod icons;
mod script;
mod settings;
mod style;
mod template;
mod theme;
mod watch;

use std::sync::mpsc;
use std::time::{Duration, Instant};

const HELP: &str = "usage: hokum [service [--replace]] [--version] [--help]
  hokum                  show the settings window (starts Hokum if needed)
  hokum service          run Hokum in the background (what hokum.service starts)
    --replace            take org.freedesktop.Notifications from another daemon
  --version              print the version
Rune's tooling flags (--snap, --scene, --size, --theme, ...) render headless.";

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    if argv.iter().any(|a| a == "--version" || a == "-V") {
        println!("hokum {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    if argv.iter().any(|a| a == "--help" || a == "-h") {
        println!("{HELP}");
        return;
    }
    let headless = argv.iter().any(|a| {
        matches!(a.as_str(), "--snap" | "--tree" | "--trace" | "--frames" | "--strip" | "--list-scenes" | "--first-pixels")
    });
    let service = argv.first().is_some_and(|a| a == "service");
    match (headless, service) {
        (true, true) => cards::headless(),
        (true, false) => rune::App::new(settings::spec()).run(),
        (false, true) => run(false, argv.iter().any(|a| a == "--replace")),
        (false, false) => launch(),
    }
}

/// `hokum`: show the running service's window. D-Bus activation starts the service when no
/// daemon owns the name; when another one does, start Hokum's unit (which stops it) and ask
/// again; with no unit, become the service here.
fn launch() {
    let token = ["XDG_ACTIVATION_TOKEN", "DESKTOP_STARTUP_ID"]
        .iter()
        .find_map(|k| std::env::var(k).ok().filter(|t| !t.is_empty()))
        .unwrap_or_default();
    if bus::forward(&token) {
        return;
    }
    let started = std::process::Command::new("systemctl")
        .args(["--user", "start", "hokum.service"])
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success());
    if started {
        let until = Instant::now() + Duration::from_secs(5);
        while Instant::now() < until {
            if bus::forward(&token) {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    run(true, true);
}

/// The service: the overlay, the settings window (hidden until asked for, unless `open`) and
/// the bus.
fn run(open: bool, replace: bool) {
    rune::set_app_id("hokum");
    let config = watch::load();
    let (out_tx, out_rx) = mpsc::channel();
    let (timer_tx, timer_rx) = mpsc::channel();
    let mut app = rune::App::new(settings::spec()).window_options(settings::window()).keep_running().args(Vec::new());
    if !open {
        app = app.windowless();
    }
    let overlay = app.overlay(cards::overlay(&config), cards::Ui::new(config.clone(), out_tx, timer_tx));
    let window = app.handle();
    cards::timers(timer_rx, overlay.clone());
    watch::spawn(overlay.clone(), window.clone());
    {
        let own = overlay.clone();
        overlay.update(move |c, _| c.handle = Some(own));
    }
    let (bus, daemon) = match bus::serve(overlay.clone(), window.clone(), out_rx, replace) {
        Ok(served) => served,
        Err(e) => {
            eprintln!("hokum: no session bus: {e}");
            std::process::exit(1);
        }
    };
    if let settings::Daemon::Other(owner) = &daemon
        && !open
    {
        eprintln!("hokum: {owner} owns org.freedesktop.Notifications; pass --replace to take it");
        std::process::exit(1);
    }
    app.init(move || {
        let mut ui = settings::init();
        ui.configure(config);
        ui.daemon = daemon;
        ui.overlay = Some(overlay);
        ui.bus = Some(bus);
        ui.handle = Some(window);
        ui
    })
    .run();
}

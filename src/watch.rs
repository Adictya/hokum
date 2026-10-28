//! Live reload: polls the settings file, the theme it names, the themes folder and the script,
//! and hands whatever changed to the overlay and the settings window. Polling a few files'
//! modification times every 700 ms costs nothing and needs no inotify plumbing.

use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use rune::{AppHandle, OverlayHandle};

use crate::style::Settings;
use crate::theme::{Problem, Theme};

/// Everything that comes from files, loaded together.
#[derive(Clone)]
pub struct Config {
    pub settings: Settings,
    /// The theme, or what went wrong reading it (the overlay keeps its last good theme).
    pub theme: Result<Theme, Vec<Problem>>,
    /// The script's source, if there is one.
    pub script: Option<String>,
}

pub fn load() -> Config {
    let settings = Settings::load();
    let theme = crate::theme::load(&settings.theme);
    let script = std::fs::read_to_string(crate::script::path()).ok();
    Config { settings, theme, script }
}

fn stamp(p: &PathBuf) -> Option<SystemTime> {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
}

fn fingerprint(theme_id: &str) -> Vec<Option<SystemTime>> {
    let mut v = vec![stamp(&crate::style::path()), stamp(&crate::script::path()), stamp(&crate::theme::dir())];
    if theme_id.contains('/') {
        v.push(stamp(&PathBuf::from(theme_id)));
    }
    v
}

pub fn spawn(overlay: OverlayHandle<crate::cards::Ui>, window: AppHandle<crate::settings::Ui>) {
    std::thread::spawn(move || {
        let mut theme_id = Settings::load().theme;
        let mut last = fingerprint(&theme_id);
        loop {
            std::thread::sleep(Duration::from_millis(700));
            let now = fingerprint(&theme_id);
            if now == last {
                continue;
            }
            let config = load();
            theme_id = config.settings.theme.clone();
            last = fingerprint(&theme_id);
            let c = config.clone();
            overlay.update(move |ui, _| ui.configure(c));
            window.update(move |ui, _| ui.configure(config));
        }
    });
}

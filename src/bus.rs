//! `org.freedesktop.Notifications` on the session bus, plus Hokum's own objects on the same
//! name: `app.hokum.Settings.Activate` (a second `hokum` shows this process's window) and
//! `app.hokum.Daemon.Reload` (re-read config.kdl). Calls arrive on zbus's thread and
//! reach the UI through Rune handles; closings and actions come back on a channel and go out
//! as signals from a thread of their own.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::Receiver;
use std::time::Duration;

use rune::{AppHandle, OverlayHandle};
use zbus::blocking::Connection;
use zbus::fdo::{RequestNameFlags, RequestNameReply};
use zbus::zvariant::OwnedValue;

use crate::card::{Note, Timeout};
use crate::icons::Source;
use crate::cards::{Out, Reason, Ui};
use crate::settings::Daemon;

const NAME: &str = "org.freedesktop.Notifications";
const PATH: &str = "/org/freedesktop/Notifications";
const SETTINGS_PATH: &str = "/app/hokum/Settings";
const SETTINGS_IFACE: &str = "app.hokum.Settings";

struct Server {
    ui: OverlayHandle<Ui>,
    next: AtomicU32,
}

fn hint<T: TryFrom<OwnedValue>>(hints: &HashMap<String, OwnedValue>, key: &str) -> Option<T> {
    hints.get(key).and_then(|v| v.try_clone().ok()).and_then(|v| T::try_from(v).ok())
}

/// The spec's `image-data` hint, `(iiibiiay)`.
fn image_data(v: &OwnedValue) -> Option<Source> {
    let s = zbus::zvariant::Structure::try_from(v.try_clone().ok()?).ok()?;
    let f = s.fields();
    let int = |i: usize| -> Option<i32> { i32::try_from(f.get(i)?).ok() };
    let alpha = bool::try_from(f.get(3)?).ok()?;
    let data = <Vec<u8>>::try_from(f.get(6)?.try_clone().ok()?).ok()?;
    crate::icons::image_data(int(0)?, int(1)?, int(2)?, alpha, int(4)?, int(5)?, &data)
}

/// Bodies may carry the spec's small markup subset; cards show plain text.
fn plain(body: &str) -> String {
    let mut out = String::with_capacity(body.len());
    let mut tag = false;
    for ch in body.chars() {
        match ch {
            '<' => tag = true,
            '>' if tag => tag = false,
            _ if !tag => out.push(ch),
            _ => {}
        }
    }
    let out = out
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&amp;", "&");
    let out = out.trim();
    // Very long bodies read as a preview.
    match out.char_indices().nth(280) {
        Some((i, _)) => format!("{}…", out[..i].trim_end()),
        None => out.to_owned(),
    }
}

/// Slack titles every message `[workspace] in #channel` (or `[workspace] from Name`) and puts
/// `Sender: message` in the body. Cards read better as sender, message, and the channel next
/// to the app's name.
fn slack(summary: &str, body: &str) -> Option<(String, String, String)> {
    let rest = summary.strip_prefix('[')?.split_once("] ")?.1;
    if let Some(channel) = rest.strip_prefix("in ") {
        let (sender, message) = body.split_once(": ").filter(|(s, _)| !s.is_empty() && s.len() <= 80)?;
        return Some((channel.to_owned(), sender.to_owned(), message.to_owned()));
    }
    let sender = rest.strip_prefix("from ")?;
    Some(("Direct message".to_owned(), sender.to_owned(), body.to_owned()))
}

/// Splits Notify's flat `[key, label, …]` list into whether there is a default action and the
/// buttons to show.
fn split_actions(actions: &[String]) -> (bool, Vec<(String, String)>) {
    let mut has_default = false;
    let mut buttons = Vec::new();
    for pair in actions.chunks(2) {
        let (key, label) = (pair[0].clone(), pair.get(1).cloned().unwrap_or_default());
        match key.as_str() {
            "default" => has_default = true,
            // Chromium adds a per-site notification "Settings" button (label localized) to
            // every web notification; KDE Plasma hides it the same way.
            "settings" => {}
            _ if !label.is_empty() => buttons.push((key, label)),
            _ => {}
        }
    }
    (has_default, buttons)
}

#[zbus::interface(name = "org.freedesktop.Notifications")]
impl Server {
    fn get_capabilities(&self) -> Vec<&'static str> {
        vec!["actions", "body", "body-markup", "persistence", "x-canonical-private-synchronous"]
    }

    #[allow(clippy::too_many_arguments)]
    fn notify(
        &self,
        app_name: String,
        replaces_id: u32,
        app_icon: String,
        summary: String,
        body: String,
        actions: Vec<String>,
        hints: HashMap<String, OwnedValue>,
        expire_timeout: i32,
    ) -> u32 {
        let id = if replaces_id != 0 { replaces_id } else { self.next.fetch_add(1, Ordering::Relaxed) };
        let app = Some(app_name)
            .filter(|a| !a.is_empty())
            .or_else(|| hint::<String>(&hints, "desktop-entry"))
            .unwrap_or_else(|| "Notification".into());
        let (summary, body) = (plain(&summary), plain(&body));
        let slacky = app.eq_ignore_ascii_case("slack") || hint::<String>(&hints, "desktop-entry").as_deref() == Some("slack");
        let mut n = match slacky.then(|| slack(&summary, &body)).flatten() {
            Some((context, sender, message)) => {
                let mut n = Note::new(id, app, sender, message);
                n.context = Some(context);
                n
            }
            None => Note::new(id, app, summary, body),
        };
        n.urgency = hint::<u8>(&hints, "urgency").unwrap_or(1);
        n.value = hint::<i32>(&hints, "value").map(|v| (v as f32 / 100.0).clamp(0.0, 1.0));
        n.tag = hint::<String>(&hints, "x-dunst-stack-tag")
            .or_else(|| hint::<String>(&hints, "x-canonical-private-synchronous"))
            .filter(|t| !t.is_empty());
        n.resident = hint::<bool>(&hints, "resident").unwrap_or(false);
        let desktop = hint::<String>(&hints, "desktop-entry");
        n.icon_src = crate::icons::for_app(&app_icon, desktop.as_deref(), &n.app).map(Source::File);
        n.desktop = desktop;
        n.image_src = ["image-data", "image_data", "icon_data"]
            .iter()
            .find_map(|k| hints.get(*k).and_then(image_data))
            .or_else(|| {
                let path = hint::<String>(&hints, "image-path").or_else(|| hint::<String>(&hints, "image_path"))?;
                crate::icons::icon(&path).map(Source::File)
            })
            // The app's own icon isn't a picture of the notification.
            .filter(|img| Some(img) != n.icon_src.as_ref());
        (n.has_default, n.actions) = split_actions(&actions);
        n.timeout = match expire_timeout {
            0 => Timeout::Never,
            t if t > 0 => Timeout::After(Duration::from_millis(t as u64)),
            _ => Timeout::Default,
        };
        self.ui.update(move |s, _| s.upsert(n));
        id
    }

    fn close_notification(&self, id: u32) {
        self.ui.update(move |s, _| s.close(id, Reason::Closed));
    }

    fn get_server_information(&self) -> (&'static str, &'static str, &'static str, &'static str) {
        ("Hokum", "anomalyco", env!("CARGO_PKG_VERSION"), "1.2")
    }
}

struct Reloader {
    ui: OverlayHandle<Ui>,
}

#[zbus::interface(name = "app.hokum.Daemon")]
impl Reloader {
    /// Re-read config.kdl, its theme and the script, and restyle live.
    fn reload(&self) {
        let config = crate::watch::load();
        self.ui.update(move |s, _| s.configure(config));
    }
}

struct Window {
    settings: AppHandle<crate::settings::Ui>,
}

#[zbus::interface(name = "app.hokum.Settings")]
impl Window {
    /// Show the settings window, focused with the launcher's activation token when there is one.
    fn activate(&self, token: String) {
        if token.is_empty() { self.settings.open() } else { self.settings.activate(token) }
    }
}

/// Follows the desktop's colour scheme (`org.freedesktop.appearance color-scheme`: 1 dark,
/// 2 light, 0 no preference, which reads as dark like the rest of Hokum).
fn follow_color_scheme(conn: &Connection, ui: OverlayHandle<Ui>) {
    let Ok(proxy) = zbus::blocking::Proxy::new(
        conn,
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.Settings",
    ) else {
        return;
    };
    // Portals answer `v`, and some wrap it twice.
    fn scheme(v: &zbus::zvariant::Value<'_>) -> Option<u32> {
        match v {
            zbus::zvariant::Value::U32(x) => Some(*x),
            zbus::zvariant::Value::Value(inner) => scheme(inner),
            _ => None,
        }
    }
    let apply = |ui: &OverlayHandle<Ui>, scheme: u32| ui.update(move |s, _| s.system_dark = scheme != 2);
    if let Ok(v) = proxy.call::<_, _, OwnedValue>("ReadOne", &("org.freedesktop.appearance", "color-scheme"))
        && let Some(sc) = scheme(&v)
    {
        apply(&ui, sc);
    }
    std::thread::spawn(move || {
        let Ok(signals) = proxy.receive_signal("SettingChanged") else { return };
        for m in signals {
            if let Ok((ns, key, v)) = m.body().deserialize::<(String, String, OwnedValue)>()
                && ns == "org.freedesktop.appearance"
                && key == "color-scheme"
                && let Some(sc) = scheme(&v)
            {
                apply(&ui, sc);
            }
        }
    });
}

/// Asks for `org.freedesktop.Notifications` (from its owner too, with `replace`) and says who
/// has it afterwards.
pub fn claim(conn: &Connection, replace: bool) -> Daemon {
    let mut flags = RequestNameFlags::AllowReplacement | RequestNameFlags::DoNotQueue;
    if replace {
        flags |= RequestNameFlags::ReplaceExisting;
    }
    match conn.request_name_with_flags(NAME, flags) {
        Ok(RequestNameReply::PrimaryOwner | RequestNameReply::AlreadyOwner) => Daemon::Hokum,
        _ => {
            let reply = conn.call_method(Some(NAME), PATH, Some(NAME), "GetServerInformation", &());
            let name = reply.and_then(|m| m.body().deserialize::<(String, String, String, String)>()).map(|i| i.0);
            Daemon::Other(name.unwrap_or_else(|_| "Another daemon".into()))
        }
    }
}

/// Serves Hokum on the session bus and claims the notifications name. Losing the name later
/// (to a newer Hokum) quits this one.
pub fn serve(
    overlay: OverlayHandle<Ui>,
    settings: AppHandle<crate::settings::Ui>,
    out: Receiver<Out>,
    replace: bool,
) -> zbus::Result<(Connection, Daemon)> {
    let conn = zbus::blocking::connection::Builder::session()?
        .serve_at(PATH, Server { ui: overlay.clone(), next: AtomicU32::new(1) })?
        .serve_at("/app/hokum/Daemon", Reloader { ui: overlay.clone() })?
        .serve_at(SETTINGS_PATH, Window { settings: settings.clone() })?
        .build()?;
    let daemon = claim(&conn, replace);
    follow_color_scheme(&conn, overlay);
    let lost = conn.clone();
    std::thread::spawn(move || {
        let Ok(proxy) = zbus::blocking::fdo::DBusProxy::new(&lost) else { return };
        let Ok(mut signals) = proxy.receive_name_lost() else { return };
        if signals.any(|s| s.args().is_ok_and(|a| a.name == NAME)) {
            settings.quit();
        }
    });
    let emit = conn.clone();
    std::thread::spawn(move || {
        for out in out {
            let _ = match out {
                Out::Closed(id, reason) => emit.emit_signal(None::<&str>, PATH, NAME, "NotificationClosed", &(id, reason as u32)),
                Out::Action(id, key, token) => {
                    // Spec 1.2: the token first, so the app can raise its window on Wayland.
                    if let Some(token) = token {
                        let _ = emit.emit_signal(None::<&str>, PATH, NAME, "ActivationToken", &(id, token));
                    }
                    emit.emit_signal(None::<&str>, PATH, NAME, "ActionInvoked", &(id, key))
                }
            };
        }
    });
    Ok((conn, daemon))
}

/// Asks the running Hokum to show its settings window (D-Bus activation starts one if
/// nothing owns the name). False when no Hokum answered.
pub fn forward(token: &str) -> bool {
    let Ok(conn) = Connection::session() else { return false };
    conn.call_method(Some(NAME), SETTINGS_PATH, Some(SETTINGS_IFACE), "Activate", &(token,)).is_ok()
}

#[cfg(test)]
mod tests {
    use super::split_actions;

    fn strings(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn actions_skip_default_settings_and_unlabeled() {
        let (has_default, buttons) =
            split_actions(&strings(&["default", "Activate", "reply", "Reply", "settings", "Einstellungen", "mute", ""]));
        assert!(has_default);
        assert_eq!(buttons, vec![("reply".to_string(), "Reply".to_string())]);
    }

    #[test]
    fn odd_trailing_key_is_dropped() {
        let (has_default, buttons) = split_actions(&strings(&["open", "Open", "dangling"]));
        assert!(!has_default);
        assert_eq!(buttons, vec![("open".to_string(), "Open".to_string())]);
    }
}

//! Raising the app a notification came from when its card is clicked. Apps that handle the
//! click themselves raise their window with the activation token Hokum hands them; plenty
//! don't (or have no default action), so on Hyprland Hokum also focuses the sender's most
//! recently used window, found by its class: the `desktop-entry` hint, that entry's
//! `StartupWMClass`, then the app's name. Elsewhere this does nothing.

use std::process::{Command, Stdio};

/// Window classes that could be the sender's, most specific first.
fn candidates(desktop: Option<&str>, app: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |c: String| {
        let c = c.trim().to_owned();
        if !c.is_empty() && !out.iter().any(|o| o.eq_ignore_ascii_case(&c)) {
            out.push(c);
        }
    };
    for id in desktop.into_iter().chain([app]) {
        let id = id.trim().trim_end_matches(".desktop");
        push(id.to_owned());
        if let Some(class) = crate::icons::wm_class(id) {
            push(class);
        }
        // Reverse-DNS ids (`com.slack.Slack`) often class their windows by the last part.
        if let Some(last) = id.rsplit('.').next().filter(|l| *l != id) {
            push(last.to_owned());
        }
        push(id.to_lowercase().replace(' ', "-"));
    }
    out
}

/// The address of the client to focus: the first candidate matching a window's class (or
/// initial class), and among those the one focused most recently.
fn pick(clients: &serde_json::Value, wanted: &[String]) -> Option<String> {
    let clients = clients.as_array()?;
    let field = |c: &serde_json::Value, k: &str| c.get(k).and_then(|v| v.as_str()).unwrap_or("").to_owned();
    wanted.iter().find_map(|w| {
        clients
            .iter()
            .filter(|c| [field(c, "class"), field(c, "initialClass")].iter().any(|k| k.eq_ignore_ascii_case(w)))
            .min_by_key(|c| c.get("focusHistoryID").and_then(|v| v.as_i64()).unwrap_or(i64::MAX))
            .map(|c| field(c, "address"))
            .filter(|a| !a.is_empty())
    })
}

/// Focuses the sender's window, off the UI thread. Does nothing outside Hyprland or when no
/// window matches.
pub fn raise(desktop: Option<String>, app: String) {
    if std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_none() {
        return;
    }
    std::thread::spawn(move || {
        let wanted = candidates(desktop.as_deref(), &app);
        let Ok(out) = Command::new("hyprctl").args(["-j", "clients"]).stderr(Stdio::null()).output() else { return };
        let Ok(clients) = serde_json::from_slice::<serde_json::Value>(&out.stdout) else { return };
        let Some(address) = pick(&clients, &wanted) else { return };
        let dispatch = |args: &[&str]| {
            Command::new("hyprctl").arg("dispatch").args(args).stderr(Stdio::null()).output().is_ok_and(|o| o.stdout.trim_ascii() == b"ok")
        };
        // A Lua config takes Lua dispatchers; a hyprland.conf one takes the classic names.
        if !dispatch(&[&format!("hl.dsp.focus({{ window = \"address:{address}\" }})")]) {
            dispatch(&["focuswindow", &format!("address:{address}")]);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_class_case_insensitively_and_prefers_the_last_focused() {
        let clients = serde_json::json!([
            { "address": "0x1", "class": "Slack", "initialClass": "Slack", "focusHistoryID": 4 },
            { "address": "0x2", "class": "slack", "initialClass": "slack", "focusHistoryID": 1 },
            { "address": "0x3", "class": "zen", "initialClass": "zen", "focusHistoryID": 0 },
        ]);
        assert_eq!(pick(&clients, &candidates(Some("slack"), "Slack")).as_deref(), Some("0x2"));
        assert_eq!(pick(&clients, &candidates(None, "Zen")).as_deref(), Some("0x3"));
        assert_eq!(pick(&clients, &candidates(None, "notify-send")), None);
    }

    #[test]
    fn reverse_dns_ids_try_their_last_part() {
        let wanted = candidates(Some("com.rtosta.zapzap"), "ZapZap");
        assert!(wanted.iter().any(|w| w == "zapzap"), "{wanted:?}");
        assert_eq!(wanted[0], "com.rtosta.zapzap");
    }
}

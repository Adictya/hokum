//! `config.kdl`: the one file that controls Hokum. It starts from a theme (`theme "soft"`) and
//! overrides anything: `behaviour`, `tokens`, `template`, `rule`. Themes are the same format, so
//! a config is a theme of your own on top of another.
//!
//! The settings window edits this file through [`Edit`], which changes only the nodes it means
//! to and keeps everything else (comments, order, spacing) as you wrote it.

use std::path::PathBuf;

use kdl::{KdlDocument, KdlEntry, KdlEntryFormat, KdlNode, KdlNodeFormat, KdlValue};

use crate::style::{Behaviour, Legacy};
use crate::theme::{Problem, Rule, Theme};

pub fn path() -> PathBuf {
    crate::style::path()
}

pub const DEFAULT: &str = r#"// Hokum's configuration. The settings window edits this file too, keeping your comments.
// Reference: https://github.com/anomalyco/hokum/blob/main/docs/theming.md
theme "soft"
"#;

/// The config, the theme it starts from, and the two merged.
#[derive(Clone)]
pub struct Loaded {
    /// The theme reference (`theme "…"`), "soft" when unset.
    pub base_id: String,
    /// That theme on its own: what the config's overrides sit on.
    pub base: Theme,
    /// The config's own overrides.
    pub own: Theme,
    /// What Hokum draws with.
    pub theme: Theme,
    pub behaviour: Behaviour,
    /// What's wrong with the config or its theme; Hokum keeps drawing with the last good one.
    pub problems: Vec<Problem>,
}

impl Loaded {
    pub fn ok(&self) -> bool {
        self.problems.is_empty()
    }
}

/// The config's text: the file, a migrated settings.json, or the default.
fn text() -> String {
    if let Ok(s) = std::fs::read_to_string(path()) {
        return s;
    }
    migrate().unwrap_or_else(|| DEFAULT.to_owned())
}

pub fn load() -> Loaded {
    let src = text();
    let mut problems = Vec::new();
    let own = match crate::theme::parse(&src, "config") {
        Ok(t) => t,
        Err(p) => {
            problems.extend(p);
            Theme::empty()
        }
    };
    let base_id = own.base.clone().unwrap_or_else(|| "soft".into());
    let base = match crate::theme::resolve(&base_id) {
        Ok(t) => t,
        Err(p) => {
            problems.extend(p.into_iter().map(|p| Problem { line: p.line, message: format!("theme `{base_id}`: {}", p.message) }));
            crate::theme::resolve("soft").unwrap_or_else(|_| Theme::empty())
        }
    };
    let mut theme = base.merge(&own);
    theme.id = base.id.clone();
    theme.name = base.name.clone();
    let behaviour = theme.behaviour();
    Loaded { base_id, base, own, theme, behaviour, problems }
}

/// settings.json, from before config.kdl, written out as a config once (and set aside).
fn migrate() -> Option<String> {
    let old = crate::style::dir().join("settings.json");
    let legacy: Legacy = serde_json::from_str(&std::fs::read_to_string(&old).ok()?).ok()?;
    let mut e = Edit { doc: DEFAULT.parse().ok()? };
    let base = match legacy.theme.as_deref().filter(|t| !t.is_empty()) {
        Some(t) => std::path::Path::new(t).file_stem().and_then(|s| s.to_str()).unwrap_or("soft").to_owned(),
        None => "soft".into(),
    };
    e.set_theme(&base);
    if let Some(p) = legacy.position {
        e.set_behaviour("position", Value::Text(p.word().into()));
    }
    if let Some(l) = legacy.linger.as_deref() {
        e.set_behaviour("stay", Value::Number(match l { "short" => 4.0, "long" => 10.0, _ => 6.0 }));
    }
    if let Some(n) = legacy.max_shown {
        e.set_behaviour("show-at-most", Value::Number(n as f64));
    }
    if let Some(b) = legacy.pause_on_hover {
        e.set_behaviour("pause-on-hover", Value::Flag(b));
    }
    if let Some(b) = legacy.do_not_disturb {
        e.set_behaviour("do-not-disturb", Value::Flag(b));
    }
    if let Some(a) = legacy.appearance {
        e.set_behaviour("appearance", Value::Text(a.word().into()));
    }
    // The old style sat under no theme; as adjustments it sits on Soft.
    if let (Some(s), true) = (legacy.style, base == "soft") {
        let soft = crate::theme::resolve("soft").ok()?.base(true);
        let adjust = crate::adjust::Adjust { base: &soft };
        adjust.corners(&mut e, s.corners);
        adjust.density(&mut e, s.density);
        adjust.mark(&mut e, s.mark);
        adjust.depth(&mut e, s.depth);
        adjust.width(&mut e, s.width);
        adjust.border(&mut e, s.border);
    }
    let text = e.doc.to_string();
    if std::fs::write(path(), &text).is_ok() {
        let _ = std::fs::rename(&old, old.with_extension("json.migrated"));
    }
    Some(text)
}

/// A value to write: Hokum spells it the way a person would.
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Text(String),
    Number(f64),
    Flag(bool),
}

impl Value {
    fn repr(&self) -> String {
        match self {
            Value::Text(s) => format!("{s:?}"),
            Value::Number(n) if n.fract() == 0.0 && n.abs() < 1e12 => format!("{}", *n as i64),
            Value::Number(n) => format!("{n}"),
            Value::Flag(b) => if *b { "#true" } else { "#false" }.into(),
        }
    }

    fn kdl(&self) -> KdlValue {
        match self {
            Value::Text(s) => KdlValue::String(s.clone()),
            Value::Number(n) if n.fract() == 0.0 => KdlValue::Integer(*n as i128),
            Value::Number(n) => KdlValue::Float(*n),
            Value::Flag(b) => KdlValue::Bool(*b),
        }
    }

    fn entry(&self) -> KdlEntry {
        let mut e = KdlEntry::new(self.kdl());
        e.set_format(KdlEntryFormat { value_repr: self.repr(), leading: " ".into(), ..Default::default() });
        e
    }

}

/// Changes the config file without disturbing what it doesn't change.
pub struct Edit {
    doc: KdlDocument,
}

fn args(node: &KdlNode) -> impl Iterator<Item = &KdlValue> {
    node.entries().iter().filter(|e| e.name().is_none()).map(|e| e.value())
}

fn props(node: &KdlNode) -> Vec<(&str, &KdlValue)> {
    node.entries().iter().filter_map(|e| Some((e.name()?.value(), e.value()))).collect()
}

/// The indentation of a block's children, from the first one (four spaces when empty).
fn indent(block: &KdlDocument) -> String {
    block
        .nodes()
        .first()
        .and_then(|n| n.format())
        .map(|f| f.leading.rsplit('\n').next().unwrap_or("").to_owned())
        .filter(|s| !s.is_empty() && s.chars().all(|c| c == ' ' || c == '\t'))
        .unwrap_or_else(|| "    ".into())
}

/// Appends `node` to `block` on its own line at the block's indentation.
fn push_child(block: &mut KdlDocument, mut node: KdlNode) {
    let leading = indent(block);
    if let Some(last) = block.nodes_mut().last_mut()
        && let Some(f) = last.format_mut()
        && !f.terminator.contains('\n')
        && !f.trailing.contains('\n')
    {
        f.terminator = "\n".into();
    }
    match node.format_mut() {
        // A snippet keeps its layout; it only takes the block's indentation.
        Some(f) => {
            f.leading = leading;
            if !f.terminator.contains('\n') && !f.trailing.contains('\n') {
                f.terminator = "\n".into();
            }
        }
        None => node.set_format(KdlNodeFormat { leading, terminator: "\n".into(), ..Default::default() }),
    }
    block.nodes_mut().push(node);
}

/// A node written out as KDL text, so it keeps exactly the layout written here.
fn snippet(text: &str) -> KdlNode {
    let doc: KdlDocument = text.parse().expect("snippets are valid KDL");
    doc.nodes()[0].clone()
}

fn new_block(name: &str) -> KdlNode {
    let mut n = KdlNode::new(name);
    n.set_children(KdlDocument::new());
    n
}

impl Edit {
    /// The config as it is on disk (or would be). Refuses to edit a file that doesn't parse,
    /// rather than overwrite what someone is in the middle of writing.
    pub fn open() -> Result<Edit, String> {
        let src = text();
        src.parse::<KdlDocument>().map(|doc| Edit { doc }).map_err(|e| format!("config.kdl doesn't parse yet ({e}); fix it and try again"))
    }

    pub fn save(&self) -> std::io::Result<()> {
        let p = path();
        if let Some(dir) = p.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = p.with_extension("kdl.tmp");
        let mut text = self.doc.to_string();
        if !text.ends_with('\n') {
            text.push('\n');
        }
        std::fs::write(&tmp, text)?;
        std::fs::rename(tmp, p)
    }

    #[cfg(test)]
    fn text(&self) -> String {
        self.doc.to_string()
    }

    /// The top-level `theme "…"`, set or added.
    pub fn set_theme(&mut self, id: &str) {
        let v = Value::Text(id.into());
        if let Some(node) = self.doc.nodes_mut().iter_mut().find(|n| n.name().value() == "theme") {
            node.entries_mut().clear();
            node.push(v.entry());
            return;
        }
        let mut node = KdlNode::new("theme");
        node.push(v.entry());
        node.set_format(KdlNodeFormat { terminator: "\n".into(), ..Default::default() });
        // After the leading comments, before everything else.
        let at = self.doc.nodes().iter().position(|_| true).unwrap_or(0);
        self.doc.nodes_mut().insert(at, node);
    }

    /// The top-level block `name` with no arguments (`tokens`, not `tokens "dark"`), added at
    /// the end when missing.
    fn block(&mut self, name: &str) -> &mut KdlDocument {
        let found = self.doc.nodes().iter().position(|n| n.name().value() == name && args(n).next().is_none());
        let i = match found {
            Some(i) => i,
            None => {
                if let Some(last) = self.doc.nodes_mut().last_mut()
                    && let Some(f) = last.format_mut()
                    && !f.terminator.contains('\n')
                {
                    f.terminator = "\n".into();
                }
                let mut node = new_block(name);
                node.autoformat();
                if let Some(f) = node.format_mut() {
                    f.leading = "\n".into();
                }
                self.doc.nodes_mut().push(node);
                self.doc.nodes().len() - 1
            }
        };
        self.doc.nodes_mut()[i].ensure_children()
    }

    fn set_in(block: &mut KdlDocument, key: &str, values: &[Value]) {
        if let Some(node) = block.nodes_mut().iter_mut().find(|n| n.name().value() == key) {
            node.entries_mut().clear();
            for v in values {
                node.push(v.entry());
            }
            return;
        }
        let mut node = KdlNode::new(key);
        for v in values {
            node.push(v.entry());
        }
        push_child(block, node);
    }

    /// Removes `key` from `block`. A node's leading text holds the line break before it, so the
    /// node after a removed one takes that break when it has none of its own.
    fn remove_in(block: &mut KdlDocument, key: &str) {
        while let Some(i) = block.nodes().iter().position(|n| n.name().value() == key) {
            let gone = block.nodes_mut().remove(i);
            let lead = gone.format().map(|f| f.leading.clone()).unwrap_or_default();
            if let Some(next) = block.nodes_mut().get_mut(i)
                && let Some(f) = next.format_mut()
                && lead.contains('\n')
                && !f.leading.contains('\n')
            {
                let breaks: String = lead.chars().take_while(|c| c.is_whitespace() && *c != ' ' && *c != '\t').collect();
                f.leading = format!("{}{}", if breaks.is_empty() { "\n".into() } else { breaks }, f.leading);
            }
        }
    }

    /// Drops a top-level block left empty.
    fn prune(&mut self, name: &str) {
        self.doc.nodes_mut().retain(|n| !(n.name().value() == name && args(n).next().is_none() && n.children().is_some_and(|c| c.nodes().is_empty())));
    }

    pub fn set_token(&mut self, key: &str, values: &[Value]) {
        Self::set_in(self.block("tokens"), key, values);
    }

    pub fn remove_token(&mut self, key: &str) {
        if self.doc.nodes().iter().any(|n| n.name().value() == "tokens") {
            Self::remove_in(self.block("tokens"), key);
            self.prune("tokens");
        }
    }

    pub fn set_behaviour(&mut self, key: &str, value: Value) {
        Self::set_in(self.block("behaviour"), key, &[value]);
    }

    pub fn remove_behaviour(&mut self, key: &str) {
        if self.doc.nodes().iter().any(|n| n.name().value() == "behaviour") {
            Self::remove_in(self.block("behaviour"), key);
            self.prune("behaviour");
        }
    }

    /// The `rule app="…"` the settings window manages for `app`: one matcher, `app`, exactly.
    fn app_rule(&mut self, app: &str, create: bool) -> Option<&mut KdlNode> {
        let i = self.doc.nodes().iter().position(|n| n.name().value() == "rule" && is_app_rule(n, app));
        let i = match (i, create) {
            (Some(i), _) => i,
            (None, false) => return None,
            (None, true) => {
                let mut node = snippet(&format!("rule app={} {{\n}}\n", Value::Text(app.into()).repr()));
                if let Some(f) = node.format_mut() {
                    f.leading = "\n".into();
                }
                if let Some(last) = self.doc.nodes_mut().last_mut()
                    && let Some(f) = last.format_mut()
                    && !f.terminator.contains('\n')
                {
                    f.terminator = "\n".into();
                }
                self.doc.nodes_mut().push(node);
                self.doc.nodes().len() - 1
            }
        };
        Some(&mut self.doc.nodes_mut()[i])
    }

    /// Sets (`Some`) or removes (`None`) one action in `app`'s rule; a rule left with nothing
    /// to do goes.
    pub fn set_app(&mut self, app: &str, action: &str, value: Option<Vec<Value>>) {
        let create = value.is_some();
        let Some(rule) = self.app_rule(app, create) else { return };
        let block = rule.ensure_children();
        match (action, value) {
            ("accent", Some(v)) => {
                let i = block.nodes().iter().position(|n| n.name().value() == "tokens");
                let tokens = match i {
                    Some(i) => block.nodes_mut()[i].ensure_children(),
                    None => {
                        let inner = format!("{}    ", indent(block));
                        let text = v.iter().map(Value::repr).collect::<Vec<_>>().join(" ");
                        let node = snippet(&format!("tokens {{\n{inner}accent {text}\n{}}}\n", indent(block)));
                        push_child(block, node);
                        return self.tidy(app);
                    }
                };
                Self::set_in(tokens, "accent", &v);
            }
            ("accent", None) => {
                if let Some(t) = block.nodes_mut().iter_mut().find(|n| n.name().value() == "tokens") {
                    Self::remove_in(t.ensure_children(), "accent");
                }
                block.nodes_mut().retain(|n| !(n.name().value() == "tokens" && n.children().is_some_and(|c| c.nodes().is_empty())));
            }
            (key, Some(v)) => Self::set_in(block, key, &v),
            (key, None) => Self::remove_in(block, key),
        }
        self.tidy(app);
    }

    /// Drops `app`'s rule when it has nothing left to do.
    fn tidy(&mut self, app: &str) {
        let app = app.to_owned();
        self.doc.nodes_mut().retain(|n| !(n.name().value() == "rule" && is_app_rule(n, &app) && n.children().is_none_or(|c| c.nodes().is_empty())));
    }
}

fn is_app_rule(n: &KdlNode, app: &str) -> bool {
    let p = props(n);
    args(n).next().is_none() && p.len() == 1 && p[0].0 == "app" && p[0].1.as_string().is_some_and(|a| a.eq_ignore_ascii_case(app))
}

/// What the settings window shows for an app, from the config's rule for it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AppRule {
    pub hide: bool,
    pub interrupt: bool,
    /// Seconds, or 0 for until dismissed.
    pub stay: Option<f32>,
    pub accent: Option<String>,
    pub template: Option<String>,
}

/// Whether a rule is one the settings window manages: it matches one app by its exact name.
pub fn simple_app(r: &Rule) -> Option<&str> {
    let app = r.app.as_deref()?;
    (r.summary.is_none() && r.body.is_none() && r.urgency.is_none() && !app.contains('*')).then_some(app)
}

/// The settings window's view of `own`'s rules: per app, and how many it can't show.
pub fn app_rules(own: &Theme) -> (Vec<(String, AppRule)>, usize) {
    let mut apps: Vec<(String, AppRule)> = Vec::new();
    let mut custom = 0;
    for r in &own.rules {
        let Some(app) = simple_app(r) else {
            custom += 1;
            continue;
        };
        let rule = AppRule {
            hide: r.hide,
            interrupt: r.interrupt,
            stay: r.timeout.map(|t| match t {
                crate::card::Timeout::After(d) => d.as_secs_f32(),
                _ => 0.0,
            }),
            accent: match r.tokens.accent() {
                Some(crate::theme::Paint::Literal(c)) => Some(c.hex()[..7].to_owned()),
                Some(crate::theme::Paint::Named(n, _)) => Some(n.clone()),
                None => None,
            },
            template: r.template.clone(),
        };
        match apps.iter_mut().find(|(a, _)| a.eq_ignore_ascii_case(app)) {
            Some((_, existing)) => *existing = rule,
            None => apps.push((app.to_owned(), rule)),
        }
    }
    (apps, custom)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edit(src: &str) -> Edit {
        Edit { doc: src.parse().unwrap() }
    }

    #[test]
    fn edits_keep_comments_and_order() {
        let mut e = edit("// mine\ntheme \"neon\" // base\n\ntokens {\n    radius 10 // rounder\n    mark \"letter\"\n}\n");
        e.set_token("radius", &[Value::Number(16.0)]);
        e.set_token("border", &[Value::Number(1.0), Value::Text("border".into())]);
        e.set_theme("soft");
        e.set_behaviour("stay", Value::Number(4.0));
        assert_eq!(
            e.text(),
            "// mine\ntheme \"soft\" // base\n\ntokens {\n    radius 16 // rounder\n    mark \"letter\"\n    border 1 \"border\"\n}\n\nbehaviour {\n    stay 4\n}\n"
        );
        e.remove_token("radius");
        assert!(e.text().contains("tokens {\n    mark \"letter\"\n"), "the next token keeps its own line: {}", e.text());
        e.remove_token("mark");
        e.remove_token("border");
        assert!(!e.text().contains("tokens"), "an empty block goes: {}", e.text());
        crate::theme::parse(&e.text(), "x").unwrap();
    }

    #[test]
    fn app_rules_come_and_go_and_leave_hand_written_ones_alone() {
        let mut e = edit("theme \"soft\"\nrule app=\"Slack*\" { hide }\n");
        e.set_app("Spotify", "hide", Some(vec![]));
        e.set_app("Slack", "accent", Some(vec![Value::Text("#d38be0".into())]));
        e.set_app("Slack", "timeout", Some(vec![Value::Number(3.0)]));
        assert!(
            e.text().contains("rule app=\"Slack\" {\n    tokens {\n        accent \"#d38be0\"\n    }\n    timeout 3\n}"),
            "new rules read like hand-written ones:\n{}",
            e.text()
        );
        let t = crate::theme::parse(&e.text(), "x").unwrap_or_else(|p| panic!("{p:?}\n{}", e.text()));
        let (apps, custom) = app_rules(&t);
        assert_eq!(custom, 1, "the glob rule isn't the window's");
        assert_eq!(apps.iter().map(|a| a.0.as_str()).collect::<Vec<_>>(), ["Spotify", "Slack"]);
        assert!(apps[0].1.hide && apps[1].1.stay == Some(3.0));
        e.set_app("Spotify", "hide", None);
        e.set_app("Slack", "accent", None);
        e.set_app("Slack", "timeout", None);
        assert_eq!(e.text(), "theme \"soft\"\nrule app=\"Slack*\" { hide }\n");
    }
}

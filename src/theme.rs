//! Themes: KDL files that restyle (`tokens`), rearrange (`template`) and route (`rule`) cards.
//! The built-in card is itself a template ([`DEFAULT`]), so everything Hokum draws goes through
//! the same interpreter (`template.rs`). See `docs/theming.md` for the reference.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use kdl::{KdlDocument, KdlNode, KdlValue};
use rune::Color;
use rune_kit::Kit;

use crate::card::{Note, Timeout};
use crate::style::{Depth, Mark, Style};

/// The built-in card, as a template.
pub const DEFAULT: &str = include_str!("../themes/default.kdl");

/// Themes that ship inside Hokum, beside the built-in card.
pub const BUNDLED: &[(&str, &str)] = &[
    ("terminal", include_str!("../themes/terminal.kdl")),
    ("bubble", include_str!("../themes/bubble.kdl")),
    ("neon", include_str!("../themes/neon.kdl")),
    ("pill", include_str!("../themes/pill.kdl")),
];

/// A colour: a theme palette name (which follows light and dark), the sending app's tint, or
/// a literal, optionally at an opacity (`"muted/50"`, `"accent/20"`).
#[derive(Clone, Debug, PartialEq)]
pub enum Paint {
    Literal(Color),
    Named(String, f32),
}

#[derive(Clone, Debug, PartialEq)]
pub enum Fill {
    Solid(Paint),
    Gradient(Paint, Paint),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Lift {
    Flat,
    Soft,
    Deep,
    /// A halo in the card's accent colour.
    Glow,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Enter {
    Slide,
    Fade,
    Scale,
    Drop,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Font {
    Sans,
    Mono,
    Named(&'static str),
}

const NAMES: &[&str] = &[
    "layer", "layer-2", "layer-3", "page", "base", "deep", "text", "muted", "faint", "border", "border-strong", "hover",
    "accent", "app", "danger", "warning", "success", "info", "white", "black", "transparent",
];

impl Paint {
    pub fn named(name: &str) -> Paint {
        Paint::Named(name.into(), 1.0)
    }

    /// The colour in `k`'s appearance, with `accent` for this card's app.
    pub fn resolve(&self, k: &Kit, accent: Color) -> Color {
        let c = &k.c;
        match self {
            Paint::Literal(color) => *color,
            Paint::Named(name, a) => {
                let base = match name.as_str() {
                    "layer" => c.layer_01,
                    "layer-2" => c.layer_02,
                    "layer-3" => c.layer_03,
                    "page" => c.page,
                    "base" => c.bg_base,
                    "deep" => c.bg_deep,
                    "text" => c.text_base,
                    "muted" => c.text_muted,
                    "faint" => c.text_faint,
                    "border" => c.border_muted,
                    "border-strong" => c.border_strong,
                    "hover" => c.hover,
                    "accent" | "app" => accent,
                    "danger" => c.danger.icon,
                    "warning" => c.warning.icon,
                    "success" => c.success.icon,
                    "info" => c.info.icon,
                    "white" => Color::WHITE,
                    "black" => Color::BLACK,
                    _ => Color::TRANSPARENT,
                };
                if *a < 1.0 { base.alpha(base.a * a) } else { base }
            }
        }
    }
}

/// Every value a card's look is made of, resolved for one card.
#[derive(Clone, Debug, PartialEq)]
pub struct Tokens {
    pub width: f32,
    pub radius: f32,
    pub padding: [f32; 4],
    pub gap: f32,
    /// Between cards.
    pub spacing: f32,
    pub badge_radius: f32,
    pub icon_size: f32,
    pub font_size: f32,
    pub title_weight: f32,
    pub font: Font,
    pub fill: Fill,
    pub text: Paint,
    pub muted: Paint,
    pub faint: Paint,
    pub border: Option<(f32, Paint)>,
    pub accent: Paint,
    pub shadow: Lift,
    pub mark: Mark,
    pub enter: Enter,
    pub motion: (f32, f32),
}

impl Tokens {
    /// What the settings window's style controls describe.
    pub fn from_style(s: &Style) -> Tokens {
        let (pad, gap, spacing) = s.spacing();
        Tokens {
            width: s.card_width(),
            radius: s.radius(),
            padding: [pad; 4],
            gap,
            spacing,
            badge_radius: s.badge_radius(),
            icon_size: 20.0,
            font_size: 13.0,
            title_weight: 550.0,
            font: Font::Sans,
            fill: Fill::Solid(Paint::named("layer")),
            text: Paint::named("text"),
            muted: Paint::named("muted"),
            faint: Paint::named("faint"),
            border: s.border.then(|| (1.0, Paint::named("border"))),
            accent: Paint::named("app"),
            shadow: match s.depth {
                Depth::Flat => Lift::Flat,
                Depth::Soft => Lift::Soft,
                Depth::Deep => Lift::Deep,
            },
            mark: s.mark,
            enter: Enter::Slide,
            motion: (0.38, 0.12),
        }
    }

    /// How far content sits from the card's edge to line up past the mark.
    pub fn indent(&self) -> f32 {
        match self.mark {
            Mark::Letter | Mark::Icon => self.icon_size + 8.0,
            Mark::Dot => 16.0,
            Mark::Stripe | Mark::None => 0.0,
        }
    }
}

/// Token values a theme or rule sets; unset ones keep what's below.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Overrides {
    width: Option<f32>,
    radius: Option<f32>,
    padding: Option<[f32; 4]>,
    gap: Option<f32>,
    spacing: Option<f32>,
    badge_radius: Option<f32>,
    icon_size: Option<f32>,
    font_size: Option<f32>,
    title_weight: Option<f32>,
    font: Option<Font>,
    fill: Option<Fill>,
    text: Option<Paint>,
    muted: Option<Paint>,
    faint: Option<Paint>,
    border: Option<Option<(f32, Paint)>>,
    accent: Option<Paint>,
    shadow: Option<Lift>,
    mark: Option<Mark>,
    enter: Option<Enter>,
    motion: Option<(f32, f32)>,
}

impl Overrides {
    pub fn apply(&self, t: &mut Tokens) {
        macro_rules! set {
            ($($f:ident),*) => { $(if let Some(v) = &self.$f { t.$f = v.clone(); })* };
        }
        set!(width, radius, padding, gap, spacing, badge_radius, icon_size, font_size, title_weight, font, fill, text, muted, faint, border, accent, shadow, mark, enter, motion);
    }
}

/// A piece of text with `{field}` and `{field|filter}` holes.
#[derive(Clone, Debug, PartialEq)]
pub struct Interp(pub Vec<Part>);

#[derive(Clone, Debug, PartialEq)]
pub enum Part {
    Text(String),
    Field(String, Vec<String>),
}

pub const FIELDS: &[&str] = &["app", "source", "context", "summary", "body", "time", "urgency", "value", "id"];
const FILTERS: &[&str] = &["upper", "lower", "initial", "trim"];

impl Interp {
    fn parse(s: &str) -> Result<Interp, String> {
        let mut parts = Vec::new();
        let mut text = String::new();
        let mut chars = s.chars().peekable();
        while let Some(ch) = chars.next() {
            match ch {
                '{' if chars.peek() == Some(&'{') => {
                    chars.next();
                    text.push('{');
                }
                '}' if chars.peek() == Some(&'}') => {
                    chars.next();
                    text.push('}');
                }
                '{' => {
                    let mut hole = String::new();
                    loop {
                        match chars.next() {
                            Some('}') => break,
                            Some(c) => hole.push(c),
                            None => return Err(format!("unclosed `{{` in \"{s}\"")),
                        }
                    }
                    let mut bits = hole.split('|').map(str::trim);
                    let field = bits.next().unwrap_or_default().to_owned();
                    if !FIELDS.contains(&field.as_str()) {
                        return Err(format!("unknown field `{field}`; fields are {}", FIELDS.join(", ")));
                    }
                    let filters: Vec<String> = bits.map(str::to_owned).collect();
                    if let Some(f) = filters.iter().find(|f| !FILTERS.contains(&f.as_str())) {
                        return Err(format!("unknown filter `{f}`; filters are {}", FILTERS.join(", ")));
                    }
                    if !text.is_empty() {
                        parts.push(Part::Text(std::mem::take(&mut text)));
                    }
                    parts.push(Part::Field(field, filters));
                }
                c => text.push(c),
            }
        }
        if !text.is_empty() {
            parts.push(Part::Text(text));
        }
        Ok(Interp(parts))
    }

    pub fn render(&self, n: &Note) -> String {
        let mut out = String::new();
        for p in &self.0 {
            match p {
                Part::Text(t) => out.push_str(t),
                Part::Field(f, filters) => {
                    let mut v = field(n, f);
                    for filter in filters {
                        v = match filter.as_str() {
                            "upper" => v.to_uppercase(),
                            "lower" => v.to_lowercase(),
                            "initial" => v.chars().find(|c| c.is_alphanumeric()).map(|c| c.to_uppercase().collect()).unwrap_or_default(),
                            "trim" => v.trim().to_owned(),
                            _ => v,
                        };
                    }
                    out.push_str(&v);
                }
            }
        }
        out
    }
}

pub fn field(n: &Note, name: &str) -> String {
    match name {
        "app" => n.app.clone(),
        "source" => match &n.context {
            Some(c) => format!("{} · {c}", n.app),
            None => n.app.clone(),
        },
        "context" => n.context.clone().unwrap_or_default(),
        "summary" => n.summary.clone(),
        "body" => n.body.clone(),
        "time" => n.time.clone(),
        "urgency" => ["low", "normal", "critical"][n.urgency.min(2) as usize].to_owned(),
        "value" => n.value.map(|v| format!("{}%", (v * 100.0).round())).unwrap_or_default(),
        "id" => n.id.to_string(),
        _ => String::new(),
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Align {
    Start,
    Center,
    End,
    Stretch,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Justify {
    Start,
    Center,
    End,
    Between,
}

/// Layout and paint a template node can set.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Props {
    pub gap: Option<f32>,
    pub padding: Option<[f32; 4]>,
    pub fill: Option<Fill>,
    pub radius: Option<f32>,
    pub border: Option<(f32, Paint)>,
    pub width: Option<f32>,
    pub height: Option<f32>,
    pub grow: bool,
    pub align: Option<Align>,
    pub justify: Option<Justify>,
    pub opacity: Option<f32>,
    pub size: Option<f32>,
    pub weight: Option<f32>,
    /// `weight="title"`: the theme's title weight.
    pub title: bool,
    pub color: Option<Paint>,
    pub lines: Option<usize>,
    pub font: Option<Font>,
    pub tracking: Option<f32>,
    /// Line up past the card's mark.
    pub indent: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Cond {
    /// The field isn't empty (or for `icon`, `image`, `actions`: the card has them).
    Has(String),
    Urgency(u8),
    App(String),
    Not(Box<Cond>),
}

#[derive(Clone, Debug, PartialEq)]
pub enum Node {
    Box { row: bool, props: Props, children: Vec<Node> },
    Text { text: Interp, props: Props },
    /// The theme's app mark (letter, icon, dot).
    Badge { props: Props },
    /// The app's icon, or its letter when it has none.
    Icon { props: Props },
    /// The notification's own picture (an avatar, a thumbnail); nothing when it has none.
    Image { props: Props },
    Progress { props: Props },
    Actions { props: Props },
    Close { props: Props },
    Spacer,
    If { cond: Cond, then: Vec<Node>, otherwise: Vec<Node> },
}

/// Matches notifications by app, text and urgency; then picks a template, changes tokens,
/// changes how long the card stays, or hides it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Rule {
    app: Option<String>,
    summary: Option<String>,
    body: Option<String>,
    urgency: Option<u8>,
    pub template: Option<String>,
    pub tokens: Overrides,
    pub timeout: Option<Timeout>,
    pub hide: bool,
}

impl Rule {
    pub fn matches(&self, n: &Note) -> bool {
        self.app.as_ref().is_none_or(|g| glob(g, &n.app))
            && self.summary.as_ref().is_none_or(|g| glob(g, &n.summary))
            && self.body.as_ref().is_none_or(|g| glob(g, &n.body))
            && self.urgency.is_none_or(|u| u == n.urgency)
    }
}

/// Case-insensitive, `*` matches any run of characters.
pub fn glob(pattern: &str, text: &str) -> bool {
    let (p, t) = (pattern.to_lowercase(), text.to_lowercase());
    let parts: Vec<&str> = p.split('*').collect();
    if parts.len() == 1 {
        return p == t;
    }
    let mut rest = t.as_str();
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }
        if i == 0 {
            let Some(r) = rest.strip_prefix(part) else { return false };
            rest = r;
        } else if i == parts.len() - 1 {
            return rest.ends_with(part);
        } else {
            let Some(at) = rest.find(part) else { return false };
            rest = &rest[at + part.len()..];
        }
    }
    true
}

#[derive(Clone, Debug, PartialEq)]
pub struct Theme {
    pub name: String,
    /// Where it came from: a bundled id or a file.
    pub id: String,
    pub tokens: Overrides,
    pub dark: Overrides,
    pub light: Overrides,
    pub templates: HashMap<String, Arc<Vec<Node>>>,
    pub rules: Vec<Rule>,
}

/// One problem in a theme file, with where it is.
#[derive(Clone, Debug, PartialEq)]
pub struct Problem {
    pub line: usize,
    pub message: String,
}

impl std::fmt::Display for Problem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "line {}: {}", self.line, self.message)
    }
}

/// What a card looks like: its tokens and the template that lays it out.
pub struct Look {
    pub tokens: Tokens,
    pub template: Arc<Vec<Node>>,
}

fn default_templates() -> &'static HashMap<String, Arc<Vec<Node>>> {
    static T: OnceLock<HashMap<String, Arc<Vec<Node>>>> = OnceLock::new();
    T.get_or_init(|| parse(DEFAULT, "default").map(|t| t.templates).unwrap_or_else(|e| panic!("default.kdl: {}", e[0])))
}

impl Theme {
    /// The built-in card with nothing changed.
    pub fn builtin() -> Theme {
        Theme {
            name: "Built-in".into(),
            id: String::new(),
            tokens: Overrides::default(),
            dark: Overrides::default(),
            light: Overrides::default(),
            templates: HashMap::new(),
            rules: Vec::new(),
        }
    }

    fn template(&self, name: &str) -> Arc<Vec<Node>> {
        self.templates
            .get(name)
            .or_else(|| default_templates().get(name))
            .or_else(|| self.templates.get("card"))
            .or_else(|| default_templates().get("card"))
            .cloned()
            .unwrap_or_default()
    }

    /// The theme's tokens over `style`, for things that aren't one card's (stack width and gaps).
    pub fn base(&self, style: &Style, dark: bool) -> Tokens {
        let mut t = Tokens::from_style(style);
        self.tokens.apply(&mut t);
        if dark { self.dark.apply(&mut t) } else { self.light.apply(&mut t) }
        t
    }

    /// The look for `n`: the theme over `style`, then every rule that matches, in order.
    pub fn look(&self, n: &Note, style: &Style, dark: bool) -> Look {
        let mut tokens = self.base(style, dark);
        let mut template = n.template.clone().unwrap_or_else(|| "card".into());
        if n.urgency >= 2 {
            // Critical cards stand out unless a rule says otherwise.
            tokens.border = Some((1.0, Paint::named("danger")));
            tokens.accent = Paint::named("danger");
        }
        for r in self.rules.iter().filter(|r| r.matches(n)) {
            r.tokens.apply(&mut tokens);
            if let Some(t) = &r.template {
                template = t.clone();
            }
        }
        Look { tokens, template: self.template(&template) }
    }

    /// Whether `n` shows at all, and for how long, after the rules.
    pub fn behaviour(&self, n: &Note) -> (bool, Option<Timeout>) {
        let mut hide = false;
        let mut timeout = None;
        for r in self.rules.iter().filter(|r| r.matches(n)) {
            hide |= r.hide;
            if r.timeout.is_some() {
                timeout = r.timeout;
            }
        }
        (hide, timeout)
    }
}

/// Font names live as long as the process; themes reload, so names are shared.
fn intern(name: &str) -> &'static str {
    static NAMES: OnceLock<Mutex<Vec<&'static str>>> = OnceLock::new();
    let mut names = NAMES.get_or_init(Mutex::default).lock().unwrap();
    if let Some(n) = names.iter().find(|n| **n == name) {
        return n;
    }
    let leaked: &'static str = Box::leak(name.to_owned().into_boxed_str());
    names.push(leaked);
    leaked
}

struct Parser<'a> {
    src: &'a str,
    problems: Vec<Problem>,
}

impl Parser<'_> {
    fn line(&self, offset: usize) -> usize {
        self.src[..offset.min(self.src.len())].matches('\n').count() + 1
    }

    fn problem(&mut self, node: &KdlNode, message: impl Into<String>) {
        let line = self.line(node.span().offset());
        self.problems.push(Problem { line, message: message.into() });
    }

    fn args<'n>(&self, node: &'n KdlNode) -> Vec<&'n KdlValue> {
        node.entries().iter().filter(|e| e.name().is_none()).map(|e| e.value()).collect()
    }

    fn props<'n>(&self, node: &'n KdlNode) -> Vec<(&'n str, &'n KdlValue)> {
        node.entries().iter().filter_map(|e| Some((e.name()?.value(), e.value()))).collect()
    }

    fn children<'n>(&self, node: &'n KdlNode) -> &'n [KdlNode] {
        node.children().map_or(&[], |d| d.nodes())
    }

    fn num(&mut self, node: &KdlNode, v: &KdlValue) -> Option<f32> {
        let n = v.as_float().or_else(|| v.as_integer().map(|i| i as f64)).map(|f| f as f32);
        if n.is_none() {
            self.problem(node, format!("`{}` wants a number, not {v}", node.name().value()));
        }
        n
    }

    fn string<'v>(&mut self, node: &KdlNode, v: &'v KdlValue) -> Option<&'v str> {
        let s = v.as_string();
        if s.is_none() {
            self.problem(node, format!("`{}` wants a string, not {v}", node.name().value()));
        }
        s
    }

    fn paint(&mut self, node: &KdlNode, v: &KdlValue) -> Option<Paint> {
        let s = self.string(node, v)?;
        if s.starts_with('#') {
            let c = rune::color::hex(s);
            if c.is_none() {
                self.problem(node, format!("`{s}` isn't a colour; use #rgb, #rrggbb or #rrggbbaa"));
            }
            return c.map(Paint::Literal);
        }
        let (name, alpha) = match s.split_once('/') {
            Some((n, a)) => match a.trim().parse::<f32>() {
                Ok(a) => (n.trim(), (a / 100.0).clamp(0.0, 1.0)),
                Err(_) => {
                    self.problem(node, format!("`{s}`: the opacity after `/` is a percentage, like `muted/50`"));
                    return None;
                }
            },
            None => (s, 1.0),
        };
        if !NAMES.contains(&name) {
            self.problem(node, format!("unknown colour `{name}`; use #hex or one of {}", NAMES.join(", ")));
            return None;
        }
        Some(Paint::Named(name.into(), alpha))
    }

    fn fill(&mut self, node: &KdlNode, args: &[&KdlValue]) -> Option<Fill> {
        match args {
            [one] => self.paint(node, one).map(Fill::Solid),
            [top, bottom] => Some(Fill::Gradient(self.paint(node, top)?, self.paint(node, bottom)?)),
            _ => {
                self.problem(node, "`fill` takes a colour, or two for a top-to-bottom gradient");
                None
            }
        }
    }

    fn padding(&mut self, node: &KdlNode, args: &[&KdlValue]) -> Option<[f32; 4]> {
        let nums: Option<Vec<f32>> = args.iter().map(|v| self.num(node, v)).collect();
        match nums?.as_slice() {
            [a] => Some([*a; 4]),
            [v, h] => Some([*h, *v, *h, *v]),
            [t, r, b, l] => Some([*l, *t, *r, *b]),
            _ => {
                self.problem(node, "`padding` takes 1 (all), 2 (vertical horizontal) or 4 (top right bottom left) numbers");
                None
            }
        }
    }

    fn keyword<T: Copy>(&mut self, node: &KdlNode, v: &KdlValue, what: &str, options: &[(&str, T)]) -> Option<T> {
        let s = self.string(node, v)?;
        let found = options.iter().find(|o| o.0 == s).map(|o| o.1);
        if found.is_none() {
            let names: Vec<&str> = options.iter().map(|o| o.0).collect();
            self.problem(node, format!("unknown {what} `{s}`; use {}", names.join(", ")));
        }
        found
    }

    fn font(&mut self, node: &KdlNode, v: &KdlValue) -> Option<Font> {
        Some(match self.string(node, v)? {
            "sans" => Font::Sans,
            "mono" => Font::Mono,
            name => Font::Named(intern(name)),
        })
    }

    fn timeout(&mut self, node: &KdlNode, v: &KdlValue) -> Option<Timeout> {
        if v.as_string() == Some("never") {
            return Some(Timeout::Never);
        }
        let s = self.num(node, v)?;
        Some(if s <= 0.0 { Timeout::Never } else { Timeout::After(Duration::from_secs_f32(s)) })
    }

    /// `tokens { radius 16; fill "layer" ... }`
    fn tokens(&mut self, block: &KdlNode) -> Overrides {
        let mut o = Overrides::default();
        for node in self.children(block) {
            let args = self.args(node);
            let name = node.name().value();
            let first = args.first().copied();
            let Some(v) = first else {
                self.problem(node, format!("`{name}` needs a value"));
                continue;
            };
            match name {
                "width" => o.width = self.num(node, v),
                "radius" => o.radius = self.num(node, v),
                "padding" => o.padding = self.padding(node, &args),
                "gap" => o.gap = self.num(node, v),
                "spacing" => o.spacing = self.num(node, v),
                "badge-radius" => o.badge_radius = self.num(node, v),
                "icon-size" => o.icon_size = self.num(node, v),
                "font-size" => o.font_size = self.num(node, v),
                "title-weight" => o.title_weight = self.num(node, v),
                "font" => o.font = self.font(node, v),
                "fill" => o.fill = self.fill(node, &args),
                "text" => o.text = self.paint(node, v),
                "muted" => o.muted = self.paint(node, v),
                "faint" => o.faint = self.paint(node, v),
                "accent" => o.accent = self.paint(node, v),
                "border" => {
                    o.border = match args.as_slice() {
                        [v] if v.as_string() == Some("none") || v.as_integer() == Some(0) => Some(None),
                        [w, c] => self.num(node, w).zip(self.paint(node, c)).map(Some),
                        _ => {
                            self.problem(node, "`border` takes a width and a colour, or \"none\"");
                            None
                        }
                    }
                }
                "shadow" => {
                    o.shadow = self.keyword(node, v, "shadow", &[("flat", Lift::Flat), ("soft", Lift::Soft), ("deep", Lift::Deep), ("glow", Lift::Glow)])
                }
                "mark" => {
                    o.mark = self.keyword(
                        node,
                        v,
                        "mark",
                        &[("letter", Mark::Letter), ("icon", Mark::Icon), ("dot", Mark::Dot), ("stripe", Mark::Stripe), ("none", Mark::None)],
                    )
                }
                "enter" => {
                    o.enter =
                        self.keyword(node, v, "entrance", &[("slide", Enter::Slide), ("fade", Enter::Fade), ("scale", Enter::Scale), ("drop", Enter::Drop)])
                }
                "motion" => match args.as_slice() {
                    [d, b] => o.motion = self.num(node, d).zip(self.num(node, b)),
                    _ => self.problem(node, "`motion` takes a duration in seconds and a bounce (0 to 1)"),
                },
                other => self.problem(node, format!("unknown token `{other}`")),
            }
        }
        o
    }

    fn node_props(&mut self, node: &KdlNode) -> Props {
        let mut p = Props::default();
        for (key, v) in self.props(node) {
            match key {
                "gap" => p.gap = self.num(node, v),
                "padding" => p.padding = self.num(node, v).map(|n| [n; 4]),
                "padding-x" => {
                    let n = self.num(node, v).unwrap_or(0.0);
                    let mut q = p.padding.unwrap_or([0.0; 4]);
                    (q[0], q[2]) = (n, n);
                    p.padding = Some(q);
                }
                "padding-y" => {
                    let n = self.num(node, v).unwrap_or(0.0);
                    let mut q = p.padding.unwrap_or([0.0; 4]);
                    (q[1], q[3]) = (n, n);
                    p.padding = Some(q);
                }
                "fill" => p.fill = self.paint(node, v).map(Fill::Solid),
                "radius" => p.radius = self.num(node, v),
                "border" => p.border = self.paint(node, v).map(|c| (1.0, c)),
                "width" => p.width = self.num(node, v),
                "height" => p.height = self.num(node, v),
                "size" => p.size = self.num(node, v),
                "grow" => p.grow = v.as_bool().unwrap_or(true),
                "indent" => p.indent = v.as_bool().unwrap_or(true),
                "opacity" => p.opacity = self.num(node, v),
                "tracking" => p.tracking = self.num(node, v),
                "lines" => p.lines = self.num(node, v).map(|n| n.max(1.0) as usize),
                "color" => p.color = self.paint(node, v),
                "font" => p.font = self.font(node, v),
                "weight" => {
                    if v.as_string() == Some("title") {
                        p.title = true;
                    } else {
                        p.weight = self.num(node, v);
                    }
                }
                "align" => {
                    p.align = self.keyword(node, v, "alignment", &[("start", Align::Start), ("center", Align::Center), ("end", Align::End), ("stretch", Align::Stretch)])
                }
                "justify" => {
                    p.justify = self.keyword(
                        node,
                        v,
                        "justification",
                        &[("start", Justify::Start), ("center", Justify::Center), ("end", Justify::End), ("between", Justify::Between)],
                    )
                }
                other => self.problem(node, format!("`{}` has no property `{other}`", node.name().value())),
            }
        }
        p
    }

    fn cond(&mut self, node: &KdlNode) -> Option<Cond> {
        let mut conds = Vec::new();
        for v in self.args(node) {
            let Some(s) = self.string(node, v) else { continue };
            if FIELDS.contains(&s) || ["icon", "image", "actions"].contains(&s) {
                conds.push(Cond::Has(s.into()));
            } else {
                self.problem(node, format!("`if \"{s}\"`: not a field; fields are {}, icon, image, actions", FIELDS.join(", ")));
            }
        }
        for (key, v) in self.props(node) {
            let Some(s) = self.string(node, v) else { continue };
            match key {
                "urgency" => match ["low", "normal", "critical"].iter().position(|u| *u == s) {
                    Some(u) => conds.push(Cond::Urgency(u as u8)),
                    None => self.problem(node, "`urgency` is low, normal or critical"),
                },
                "app" => conds.push(Cond::App(s.into())),
                "not" => conds.push(Cond::Not(Box::new(Cond::Has(s.into())))),
                other => self.problem(node, format!("`if` has no condition `{other}`")),
            }
        }
        if conds.len() > 1 {
            self.problem(node, "`if` takes one condition; nest them for more");
        }
        let c = conds.into_iter().next();
        if c.is_none() {
            self.problem(node, "`if` needs a condition, like `if \"body\"` or `if urgency=\"critical\"`");
        }
        c
    }

    fn template(&mut self, nodes: &[KdlNode]) -> Vec<Node> {
        let mut out: Vec<Node> = Vec::new();
        for node in nodes {
            let name = node.name().value();
            let built = match name {
                "row" | "col" => {
                    let props = self.node_props(node);
                    let children = self.template(self.children(node));
                    Some(Node::Box { row: name == "row", props, children })
                }
                "text" => {
                    let props = self.node_props(node);
                    match self.args(node).first().and_then(|v| v.as_string()) {
                        Some(s) => match Interp::parse(s) {
                            Ok(text) => Some(Node::Text { text, props }),
                            Err(e) => {
                                self.problem(node, e);
                                None
                            }
                        },
                        None => {
                            self.problem(node, "`text` needs a string, like `text \"{summary}\"`");
                            None
                        }
                    }
                }
                "badge" => Some(Node::Badge { props: self.node_props(node) }),
                "icon" => Some(Node::Icon { props: self.node_props(node) }),
                "image" => Some(Node::Image { props: self.node_props(node) }),
                "progress" => Some(Node::Progress { props: self.node_props(node) }),
                "actions" => Some(Node::Actions { props: self.node_props(node) }),
                "close" => Some(Node::Close { props: self.node_props(node) }),
                "spacer" => Some(Node::Spacer),
                "if" => {
                    let cond = self.cond(node);
                    let then = self.template(self.children(node));
                    cond.map(|cond| Node::If { cond, then, otherwise: Vec::new() })
                }
                "else" => {
                    let children = self.template(self.children(node));
                    match out.last_mut() {
                        Some(Node::If { otherwise, .. }) if otherwise.is_empty() => {
                            *otherwise = children;
                        }
                        _ => self.problem(node, "`else` must follow an `if`"),
                    }
                    None
                }
                other => {
                    self.problem(
                        node,
                        format!("unknown element `{other}`; use row, col, text, badge, icon, image, progress, actions, close, spacer, if, else"),
                    );
                    None
                }
            };
            out.extend(built);
        }
        out
    }

    fn rule(&mut self, node: &KdlNode) -> Rule {
        let mut r = Rule::default();
        for (key, v) in self.props(node) {
            let Some(s) = self.string(node, v) else { continue };
            match key {
                "app" => r.app = Some(s.into()),
                "summary" => r.summary = Some(s.into()),
                "body" => r.body = Some(s.into()),
                "urgency" => match ["low", "normal", "critical"].iter().position(|u| *u == s) {
                    Some(u) => r.urgency = Some(u as u8),
                    None => self.problem(node, "`urgency` is low, normal or critical"),
                },
                other => self.problem(node, format!("`rule` has no matcher `{other}`; use app, summary, body, urgency")),
            }
        }
        for child in self.children(node) {
            let args = self.args(child);
            match child.name().value() {
                "template" => r.template = args.first().and_then(|v| self.string(child, v)).map(str::to_owned),
                "tokens" => r.tokens = self.tokens(child),
                "timeout" => r.timeout = args.first().and_then(|v| self.timeout(child, v)),
                "hide" => r.hide = true,
                other => self.problem(child, format!("unknown rule action `{other}`; use template, tokens, timeout, hide")),
            }
        }
        r
    }
}

/// Parses a theme. Problems are collected rather than stopping at the first, so the settings
/// window can list them all.
pub fn parse(src: &str, id: &str) -> Result<Theme, Vec<Problem>> {
    let doc = match KdlDocument::parse(src) {
        Ok(d) => d,
        Err(e) => {
            let problems = e
                .diagnostics
                .iter()
                .map(|d| {
                    let offset = d.span.offset();
                    let line = src[..offset.min(src.len())].matches('\n').count() + 1;
                    let msg = d.message.clone().unwrap_or_else(|| "syntax error".into());
                    Problem { line, message: d.help.as_ref().map_or(msg.clone(), |h| format!("{msg} ({h})")) }
                })
                .collect::<Vec<_>>();
            return Err(if problems.is_empty() { vec![Problem { line: 1, message: e.to_string() }] } else { problems });
        }
    };
    let mut p = Parser { src, problems: Vec::new() };
    let mut theme = Theme::builtin();
    theme.id = id.into();
    theme.name = id.into();
    for node in doc.nodes() {
        let args = p.args(node);
        match node.name().value() {
            "theme" => {
                if let Some(name) = args.first().and_then(|v| v.as_string()) {
                    theme.name = name.into();
                }
            }
            "tokens" => {
                let o = p.tokens(node);
                match args.first().and_then(|v| v.as_string()) {
                    None => theme.tokens = o,
                    Some("dark") => theme.dark = o,
                    Some("light") => theme.light = o,
                    Some(other) => p.problem(node, format!("`tokens \"{other}\"`: use `tokens`, `tokens \"dark\"` or `tokens \"light\"`")),
                }
            }
            "template" => match args.first().and_then(|v| v.as_string()) {
                Some(name) => {
                    let nodes = p.template(p.children(node));
                    theme.templates.insert(name.into(), Arc::new(nodes));
                }
                None => p.problem(node, "`template` needs a name, like `template \"card\" { ... }`"),
            },
            "rule" => {
                let r = p.rule(node);
                theme.rules.push(r);
            }
            other => p.problem(node, format!("unknown section `{other}`; use theme, tokens, template, rule")),
        }
    }
    for r in &theme.rules {
        if let Some(t) = &r.template
            && !theme.templates.contains_key(t)
            && !default_templates_contains(t)
        {
            p.problems.push(Problem { line: 1, message: format!("a rule uses template `{t}`, which isn't defined") });
        }
    }
    if p.problems.is_empty() { Ok(theme) } else { Err(p.problems) }
}

/// Whether the default file defines `name`, without parsing it (parsing it runs this check).
fn default_templates_contains(name: &str) -> bool {
    DEFAULT.contains(&format!("template \"{name}\""))
}

/// Where user themes live.
pub fn dir() -> PathBuf {
    crate::style::path().with_file_name("themes")
}

/// The bundled themes and the files in the themes folder, by id: a bundled name or a file path.
pub fn available() -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = BUNDLED.iter().map(|(id, src)| (id.to_string(), title(src).unwrap_or_else(|| id.to_string()))).collect();
    if let Ok(entries) = std::fs::read_dir(dir()) {
        let mut files: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e == "kdl")).collect();
        files.sort();
        for f in files {
            let name = std::fs::read_to_string(&f).ok().and_then(|s| title(&s)).unwrap_or_else(|| stem(&f));
            out.push((f.display().to_string(), name));
        }
    }
    out
}

fn stem(p: &Path) -> String {
    p.file_stem().and_then(|s| s.to_str()).unwrap_or("theme").to_owned()
}

/// The `theme "Name"` line, without parsing the rest.
fn title(src: &str) -> Option<String> {
    src.lines().find_map(|l| l.trim().strip_prefix("theme ")?.trim().strip_prefix('"')?.split('"').next().map(str::to_owned))
}

/// Loads a theme by id: "" is the built-in card, a bundled name, or a file path.
pub fn load(id: &str) -> Result<Theme, Vec<Problem>> {
    if id.is_empty() {
        return Ok(Theme::builtin());
    }
    if let Some((_, src)) = BUNDLED.iter().find(|(b, _)| *b == id) {
        return parse(src, id);
    }
    let src = std::fs::read_to_string(id).map_err(|e| vec![Problem { line: 0, message: format!("can't read {id}: {e}") }])?;
    let mut t = parse(&src, id)?;
    if t.name == id {
        t.name = stem(Path::new(id));
    }
    Ok(t)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_bundled_theme_and_the_default_parse() {
        parse(DEFAULT, "default").unwrap();
        for (id, src) in BUNDLED {
            if let Err(e) = parse(src, id) {
                panic!("{id}: {}", e.iter().map(|p| p.to_string()).collect::<Vec<_>>().join("; "));
            }
        }
    }

    #[test]
    fn problems_say_where_and_what() {
        let src = "theme \"x\"\ntokens {\n  radius \"big\"\n  colour \"#fff\"\n}\ntemplate \"card\" {\n  text \"{nope}\"\n}\n";
        let e = parse(src, "x").unwrap_err();
        let lines: Vec<usize> = e.iter().map(|p| p.line).collect();
        assert_eq!(lines, [3, 4, 7], "{e:?}");
        assert!(e[2].message.contains("unknown field `nope`"));
    }

    #[test]
    fn rules_match_with_globs_and_apply_in_order() {
        let src = r##"
rule app="slack" { template "card"; tokens { radius 2; } }
rule summary="*urgent*" { tokens { radius 30; }; timeout "never" }
rule app="Spotify" { hide }
"##;
        let t = parse(src, "x").unwrap();
        let mut n = Note::new(1, "Slack", "very URGENT thing", "");
        let look = t.look(&n, &Style::default(), true);
        assert_eq!(look.tokens.radius, 30.0, "later rules win");
        assert_eq!(t.behaviour(&n), (false, Some(Timeout::Never)));
        n.app = "Spotify".into();
        n.summary = "song".into();
        assert!(t.behaviour(&n).0);
        assert!(glob("a*c", "abbbc") && !glob("a*c", "abd") && glob("*", "") && glob("Slack", "slack"));
    }

    #[test]
    fn interpolation_fills_fields_and_filters() {
        let mut n = Note::new(7, "Slack", "Dax", "hi");
        n.context = Some("#abattoir".into());
        let i = Interp::parse("{source}: {summary|upper} {{x}} {app|initial}").unwrap();
        assert_eq!(i.render(&n), "Slack · #abattoir: DAX {x} S");
        assert!(Interp::parse("{summary|shout}").is_err());
    }
}

//! The settings window's six look controls, as tokens in the config. Each one shows the theme's
//! value until it's changed; picking the theme's own value removes the override, so the config
//! only ever holds real changes.

use crate::config::{Edit, Value};
use crate::style::{Corners, Density, Depth, Mark, Width};
use crate::theme::{Lift, Tokens};

/// The tokens the controls write; Reset removes these.
pub const KEYS: &[&str] = &["radius", "badge-radius", "padding", "gap", "spacing", "width", "mark", "shadow", "border"];

/// Writes control choices as overrides over `base`, the theme's own tokens.
pub struct Adjust<'a> {
    pub base: &'a Tokens,
}

impl Adjust<'_> {
    pub fn corners(&self, e: &mut Edit, c: Corners) {
        let (r, b) = c.radii();
        if (self.base.radius, self.base.badge_radius) == (r, b) {
            e.remove_token("radius");
            e.remove_token("badge-radius");
        } else {
            e.set_token("radius", &[Value::Number(r as f64)]);
            e.set_token("badge-radius", &[Value::Number(b as f64)]);
        }
    }

    pub fn density(&self, e: &mut Edit, d: Density) {
        let (p, g, s) = d.spacing();
        if (self.base.padding, self.base.gap, self.base.spacing) == ([p; 4], g, s) {
            for k in ["padding", "gap", "spacing"] {
                e.remove_token(k);
            }
        } else {
            e.set_token("padding", &[Value::Number(p as f64)]);
            e.set_token("gap", &[Value::Number(g as f64)]);
            e.set_token("spacing", &[Value::Number(s as f64)]);
        }
    }

    pub fn mark(&self, e: &mut Edit, m: Mark) {
        if self.base.mark == m { e.remove_token("mark") } else { e.set_token("mark", &[Value::Text(m.word().into())]) }
    }

    pub fn depth(&self, e: &mut Edit, d: Depth) {
        let same = matches!((self.base.shadow, d), (Lift::Flat, Depth::Flat) | (Lift::Soft, Depth::Soft) | (Lift::Deep, Depth::Deep));
        if same { e.remove_token("shadow") } else { e.set_token("shadow", &[Value::Text(d.word().into())]) }
    }

    pub fn width(&self, e: &mut Edit, w: Width) {
        if self.base.width == w.points() { e.remove_token("width") } else { e.set_token("width", &[Value::Number(w.points() as f64)]) }
    }

    pub fn border(&self, e: &mut Edit, on: bool) {
        match (self.base.border.is_some(), on) {
            (a, b) if a == b => e.remove_token("border"),
            (_, true) => e.set_token("border", &[Value::Number(1.0), Value::Text("border".into())]),
            (_, false) => e.set_token("border", &[Value::Text("none".into())]),
        }
    }
}

/// What each control shows for `t` (the merged tokens). None when the theme uses a value the
/// control doesn't offer (Signal's 18 point corners, Terminal's padding), so nothing is selected.
pub fn corners(t: &Tokens) -> Option<Corners> {
    Corners::ALL.into_iter().find(|c| c.radii().0 == t.radius)
}

pub fn density(t: &Tokens) -> Option<Density> {
    Density::ALL.into_iter().find(|d| {
        let (p, g, s) = d.spacing();
        t.padding == [p; 4] && t.gap == g && t.spacing == s
    })
}

pub fn depth(t: &Tokens) -> Option<Depth> {
    match t.shadow {
        Lift::Flat => Some(Depth::Flat),
        Lift::Soft => Some(Depth::Soft),
        Lift::Deep => Some(Depth::Deep),
        Lift::Glow => None,
    }
}

pub fn width(t: &Tokens) -> Option<Width> {
    Width::ALL.into_iter().find(|w| w.points() == t.width)
}

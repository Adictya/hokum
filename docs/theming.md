# Theming Hokum

Hokum's look comes in three layers, each on top of the one before:

1. **Style:** the controls in the settings window (corners, density, app mark, shadow, width,
   border, appearance).
2. **Theme:** a [KDL](https://kdl.dev) file that can change any **token**, lay cards out with
   **templates**, and route notifications with **rules**.
3. **Script:** a [Rhai](https://rhai.rs) function that sees every notification first and can
   rewrite, route or drop it.

Themes live in `~/.config/hokum/themes/*.kdl` (`$XDG_CONFIG_HOME`). Pick one in the settings
window, or start one with **New theme**, which writes your current style out as a theme and
opens it in your editor. Saving applies it at once; problems show in the settings window with
their line numbers, and the overlay keeps the last theme that worked.

Hokum ships four themes to start from: [Terminal](../themes/terminal.kdl),
[Bubble](../themes/bubble.kdl), [Neon](../themes/neon.kdl) and [Pill](../themes/pill.kdl). The
built-in card is itself a template, [default.kdl](../themes/default.kdl).

```kdl
theme "Sunset"

tokens {
    radius 18
    fill "#2b1630" "#120a17"     // two colours: a top-to-bottom gradient
    border 1 "accent/60"
    shadow "glow"
}

tokens "light" {
    fill "#fff4ec" "#ffe3d6"
}

template "card" {
    row gap=8 align="center" {
        icon
        text "{source|upper}" size=10 weight=700 tracking=1 color="accent" grow=#true
        text "{time}" size=11 color="faint"
        close
    }
    if "summary" { text "{summary}" weight="title" indent=#true }
    if "body" { text "{body}" color="muted" lines=4 }
    actions
}

rule app="Slack" { tokens { accent "#d38be0" } }
rule app="Spotify" { hide }
rule urgency="critical" { timeout "never" }
```

## Tokens

`tokens { ... }` sets values for every card; `tokens "dark" { ... }` and `tokens "light" { ... }`
set them for one appearance. Anything a theme leaves out keeps the settings window's value.

| Token | Value | What it does |
|---|---|---|
| `width` | points | Card width |
| `radius` | points | Card corner radius (`999` for a pill) |
| `padding` | 1, 2 or 4 numbers | Inside the card: all, vertical horizontal, or top right bottom left |
| `gap` | points | Between a card's rows |
| `spacing` | points | Between cards |
| `badge-radius` | points | Corner radius of badges and icons |
| `icon-size` | points | Badge and icon size |
| `font` | `"sans"`, `"mono"` or a family name | Typeface for all text |
| `font-size` | points | Default text size |
| `title-weight` | 100 to 900 | The weight `weight="title"` uses |
| `fill` | colour, or two for a gradient | Card background |
| `text`, `muted`, `faint` | colour | The three text colours templates use by name |
| `border` | width and colour, or `"none"` | Card border |
| `accent` | colour | The card's accent; `"app"` is a colour per sending app |
| `shadow` | `flat`, `soft`, `deep`, `glow` | `glow` is a halo in the accent colour |
| `mark` | `icon`, `letter`, `dot`, `stripe`, `none` | What `badge` draws; `stripe` adds an accent bar down the card |
| `enter` | `slide`, `fade`, `scale`, `drop` | How cards arrive and leave |
| `motion` | seconds and bounce (0 to 1) | The spring every card moves on |

### Colours

A colour is `"#rgb"`, `"#rrggbb"` or `"#rrggbbaa"`, or a palette name that follows light and
dark: `layer` `layer-2` `layer-3` `page` `base` `deep` `text` `muted` `faint` `border`
`border-strong` `hover` `accent` `app` `danger` `warning` `success` `info` `white` `black`
`transparent`. Add an opacity as a percentage: `"accent/30"`, `"black/50"`.

## Templates

A template lays out a card's contents; the card itself (its fill, border, shadow, padding and
radius) comes from the tokens. A theme's `template "card"` is used for every notification
unless a rule or script picks another. A theme can define as many templates as it likes.

### Elements

| Element | What it draws |
|---|---|
| `row { ... }` / `col { ... }` | A horizontal or vertical group |
| `text "…"` | Text with `{field}` holes |
| `badge` | The app mark from the `mark` token |
| `icon` | The app's icon from your icon theme, or its letter |
| `image` | The notification's own picture (an avatar, a thumbnail); nothing if it has none |
| `progress` | A progress bar, when the notification has a value |
| `actions` | The notification's buttons |
| `close` | The dismiss button |
| `spacer` | Fills the free space in a row |
| `if … { } else { }` | Draws its contents only when the condition holds |

### Properties

| Property | On | Value |
|---|---|---|
| `gap` | row, col | points between children |
| `padding`, `padding-x`, `padding-y` | row, col | points |
| `fill`, `border` | row, col | colour |
| `radius` | row, col, icon, image, close | points |
| `width`, `height` | row, col, image | points |
| `size` | text, badge, icon, image, close | points |
| `grow` | any | `#true` to take the free space in its row |
| `indent` | row, col, actions | `#true` to line up past the badge |
| `align` | row, col | `start`, `center`, `end`, `stretch` (across) |
| `justify` | row, col | `start`, `center`, `end`, `between` (along) |
| `opacity` | row, col, text | 0 to 1 |
| `weight` | text | 100 to 900, or `"title"` |
| `color` | text, close | colour (default `text`) |
| `lines` | text | the most lines to show; `1` ends with an ellipsis |
| `font`, `tracking` | text | typeface; letter spacing in points |

Text in a column wraps across its width; text in a row stays on one line unless it has `lines`.

### Fields and filters

`app`, `source` (the app, plus the channel for Slack), `context` (the channel), `summary`,
`body`, `time`, `urgency` (`low`, `normal`, `critical`), `value` (`62%`), `id`.

Filters follow a `|`: `{app|upper}`, `{summary|lower}`, `{app|initial}`, `{body|trim}`. Write
`{{` and `}}` for literal braces.

### Conditions

`if "body"` holds when a field isn't empty; `"icon"`, `"image"` and `"actions"` hold when the
card has them. Also `if urgency="critical"`, `if app="Slack*"` and `if not="body"`. An `else`
on the next line draws when the condition doesn't hold.

## Rules

A rule matches notifications and changes them. Matchers are `app`, `summary`, `body` (case
insensitive, `*` matches anything) and `urgency`; a rule with several matchers needs them all.
Every matching rule applies in order, so later rules win.

```kdl
rule app="Slack" summary="*incident*" {
    template "alert"          // a template from this theme
    tokens { fill "danger/20" }
    timeout "never"           // or seconds
}
rule app="Spotify" { hide }
```

Critical notifications get a `danger` border and accent before any rule runs; a rule can
change them back.

## Scripts

`~/.config/hokum/script.rhai` defines `notify(n)`, which runs before rules for every
notification. Return `n` (changed or not) to show it, or `false` to drop it. **Create script**
in the settings window writes a starter.

```rhai
fn notify(n) {
    if n.app == "Spotify" { return false; }
    if n.body.contains("deploy failed") {
        n.urgency = 2;
        n.template = "alert";
    }
    n.summary.replace("[anoma-ly] ", "");   // string methods edit in place
    n
}
```

| Field | Type |
|---|---|
| `n.app`, `n.summary`, `n.body`, `n.context` | strings |
| `n.urgency` | 0 low, 1 normal, 2 critical |
| `n.value` | 0.0 to 1.0, or `()` |
| `n.timeout` | seconds, `0` until dismissed, `()` for the default |
| `n.template` | a template name, or `()` |
| `n.actions` | `[#{ key: "reply", label: "Reply" }, ...]` |
| `n.id` | read only |

Scripts have an operation budget: one that loops forever fails that notification, which then
shows unchanged, and Hokum carries on.

## Icons and pictures

`icon` and the `icon` mark find the app's icon in your icon theme (GTK's `gtk-icon-theme-name`,
its parents, then hicolor) from the notification's `app_icon`, its `desktop-entry`, or the app's
name. `image` shows the picture a notification carries (`image-data` or `image-path`): an
avatar, an album cover, a screenshot.

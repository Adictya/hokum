# Configuring and theming Hokum

Everything about Hokum lives in one file, `~/.config/hokum/config.kdl` (`$XDG_CONFIG_HOME`).
It starts from a theme and overrides whatever you like:

```kdl
theme "signal"               // start from a theme (default: "soft")

behaviour {
    position "bottom-right"
    stay 6                   // seconds, when the app doesn't say
    show-at-most 5
    pause-on-hover #true
    do-not-disturb #false
    appearance "system"      // system, light, dark
}

tokens {                     // anything about the look
    radius 10
    border "none"
}

rule app="Slack" { tokens { accent "#d38be0" } }
rule app="Spotify" { hide }
```

The settings window is an editor for this file. Picking a theme writes `theme "…"`, the look
controls write `tokens`, behaviour writes `behaviour`, and the Apps section writes
`rule app="…"` blocks. Changes keep your comments and layout, and choosing a theme's own value
removes the override rather than repeating it. Edit the file by hand and the window and the
notifications update as you save; problems show in the window with line numbers, and Hokum
keeps drawing with the last config that worked.

**Themes** use the same format. Built-in ones are fixed: [Soft](../themes/soft.kdl),
[Crisp](../themes/crisp.kdl), [Capsule](../themes/capsule.kdl), [Ribbon](../themes/ribbon.kdl),
[Terminal](../themes/terminal.kdl), [Bubble](../themes/bubble.kdl), [Signal](../themes/signal.kdl)
and [Pill](../themes/pill.kdl). Referencing one keeps you on its latest version with your
overrides on top. **Clone to edit** copies it into `~/.config/hokum/themes/` to change
everything; `theme "my-signal"` then refers to `themes/my-signal.kdl`. Any path works too
(`theme "~/dotfiles/hokum/work.kdl"`). A theme can itself start from another theme.

A theme names itself with `name "…"` (shown in the gallery). The built-in card is a template,
[default.kdl](../themes/default.kdl), which every theme falls back to.

A **script** (`~/.config/hokum/script.rhai`) is separate because it's code: it sees every
notification first and can rewrite, route or drop it.

## Behaviour

| Key | Value |
|---|---|
| `position` | `top-right`, `top-left`, `bottom-right`, `bottom-left` (on the focused screen) |
| `stay` | seconds ordinary notifications stay when the app doesn't say |
| `show-at-most` | cards shown at once; the rest wait behind a "N more" pill |
| `pause-on-hover` | `#true`: timers wait while the pointer is over a card |
| `do-not-disturb` | `#true`: only critical notifications, and apps whose rule has `interrupt`, show |
| `appearance` | `system`, `light`, `dark` |

## Tokens

`tokens { ... }` sets values for every card; `tokens "dark" { ... }` and `tokens "light" { ... }`
set them for one appearance. Anything left out keeps the theme's value (and a theme's, the
defaults: Soft's).

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
Every matching rule applies in order, a theme's before the config's, so later rules win.
Actions: `template "…"`, `tokens { … }`, `timeout` (seconds or `"never"`), `hide`, and
`interrupt` (show even during Do not disturb).

The settings window manages rules that match one app by its exact name (`rule app="Slack"`);
rules matching text or urgency are yours to edit in the file, and the window counts them.

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

# Hokum

Notifications for Wayland that look like they belong on a computer from this decade.

Hokum is a freedesktop notification daemon (`org.freedesktop.Notifications`) for compositors
with `zwlr_layer_shell_v1`: niri, sway, Hyprland, river and others. It draws its cards with
[Rune](https://github.com/anomalyco/rune), our Rust UI framework, so they slide in, restack on
springs and get out of the way. A settings window lets you restyle them live.

## Install

From the AUR:

```sh
paru -S hokum-bin
```

Or unpack a tarball from [Releases](https://github.com/anomalyco/hokum/releases) and install
`hokum` on your `PATH` together with the systemd unit, D-Bus activation file and launcher entry
next to it.

Hokum starts through D-Bus activation on the first notification. To start it with your session
instead, and stop another daemon (mako, dunst, swaync) holding the name:

```sh
systemctl --user enable --now hokum.service
```

## Use

```sh
hokum                     # the settings window (starts Hokum if it isn't running)
hokum service [--replace] # run in the background (what hokum.service starts)
hokum --version
```

Like Hex, Hokum is one process: the service owns the bus name, draws the cards on a
click-through overlay and hosts the settings window. Launching `hokum` again shows that window.

- **Styles:** four presets (Soft, Crisp, Capsule and Ribbon), or set corners, density, app
  mark (letter, dot, stripe or none), shadow, width, border and appearance yourself.
- **Behaviour:** screen corner, how long cards stay, how many show, pause while hovered, and
  Do not disturb (only critical notifications show).
- **Cards:** action buttons, a click for the default action, progress bars (`value`), and
  in-place replacement by `x-dunst-stack-tag` / `x-canonical-private-synchronous` (volume,
  brightness). Critical notifications stay until dismissed. Slack's `[workspace] in #channel`
  titles become the sender, the message, and the channel beside the app's name.

Settings live in `$XDG_CONFIG_HOME/hokum/settings.json`. After editing the file by hand, run
`gdbus call --session --dest org.freedesktop.Notifications --object-path /app/hokum/Daemon
--method app.hokum.Daemon.Reload` to apply it.

## Build

```sh
cargo build --release
target/release/hokum service --snap cards.png --scene demo   # headless render, no D-Bus
target/release/hokum --snap settings.png --scene hokum
```

Releases are cut by `.github/workflows/release.yml`; see [docs/releasing.md](docs/releasing.md).

## License

MIT

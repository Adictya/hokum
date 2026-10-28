#!/usr/bin/env bash
# Renders every built-in theme's demo cards with Hokum itself, in dark and light, into
# site/screenshots/<id>-<dark|light>.webp.
#
# Rendering needs a GPU, so the build and the renders run on a remote host (default `apollo`,
# override with HOKUM_GPU_HOST). The current branch is pushed to a throwaway clone there, built
# with its own target dir, and rendered with a throwaway XDG_CONFIG_HOME per theme, so the host's
# installed hokum and ~/.config/hokum are never touched. Everything under /tmp/hokum-site-* on
# the host is removed afterwards (the target dir is kept for faster rebuilds unless CLEAN=1).
#
# Needs locally: git, ssh, scp, ffmpeg (with libwebp). Usage: site/scripts/screenshots.sh
set -euo pipefail

host="${HOKUM_GPU_HOST:-apollo}"
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
out="$root/site/screenshots"
branch="$(git -C "$root" rev-parse --abbrev-ref HEAD)"
remote_src=/tmp/hokum-site-build
remote_target=/tmp/hokum-site-target
remote_out=/tmp/hokum-site-shots

themes=()
for f in "$root"/themes/*.kdl; do
  id="$(basename "$f" .kdl)"
  [ "$id" = default ] || themes+=("$id")
done

echo "pushing $branch to $host:$remote_src"
ssh "$host" "rm -rf $remote_src $remote_out && git init -q $remote_src"
git -C "$root" push -q -f "$host:$remote_src" "HEAD:refs/heads/snap"
ssh "$host" "git -C $remote_src checkout -q snap"

echo "building on $host"
ssh "$host" "cd $remote_src && CARGO_TARGET_DIR=$remote_target cargo build --release -q"

echo "rendering ${themes[*]}"
ssh "$host" bash -s -- "$remote_target/release/hokum" "$remote_out" "${themes[@]}" <<'EOF'
set -euo pipefail
bin="$1"; out="$2"; shift 2
mkdir -p "$out"
for id in "$@"; do
  cfg="$(mktemp -d /tmp/hokum-site-cfg.XXXXXX)"
  mkdir -p "$cfg/hokum"
  printf 'theme "%s"\n' "$id" > "$cfg/hokum/config.kdl"
  for mode in dark light; do
    XDG_CONFIG_HOME="$cfg" "$bin" service --snap "$out/$id-$mode.png" --scene demo --theme "$mode"
  done
  rm -rf "$cfg"
done
EOF

tmp="$(mktemp -d)"
scp -q "$host:$remote_out/*.png" "$tmp/"
if [ "${CLEAN:-0}" = 1 ]; then
  ssh "$host" "rm -rf $remote_src $remote_out $remote_target"
else
  ssh "$host" "rm -rf $remote_src $remote_out"
fi

# The overlay is as wide as the theme's cards and taller than the stack. Give every shot the
# same frame (W x H at 2x) so the gallery shows the themes at one scale: crop the empty bottom
# and widen by smearing the edge columns (the desktop gradient is vertical, so that's seamless).
W=960
H=1260
mkdir -p "$out"
for png in "$tmp"/*.png; do
  name="$(basename "$png" .png)"
  w="$(ffprobe -v error -show_entries stream=width -of csv=p=0 "$png")"
  l=$(( (W - w) / 2 ))
  r=$(( W - w - l ))
  ffmpeg -loglevel error -y -i "$png" \
    -vf "crop=iw:min(ih\,$H):0:0,pad=$W:ih:$l:0,fillborders=left=$l:right=$r:mode=smear" \
    -c:v libwebp -lossless 0 -quality 92 -compression_level 6 "$out/$name.webp"
done
rm -rf "$tmp"
ls -la "$out"

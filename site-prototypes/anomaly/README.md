# Hero prototype: the Anomaly team argues about the landing page, live

A quiet desktop with only the install command on it. Then the team starts arguing in the corner as
Slack notifications, drawn as Hokum Capsule cards (`themes/capsule.kdl` over `themes/default.kdl`,
dark), stacking top-right with Hokum's spring (response 0.38 s, bounce 0.12), five shown and an
"N more · Clear all" pill, like the daemon. The ideas start a fight for the corner, the cards shove
the install command off the page, a critical card says to ship the install command, everything
clears and the command comes back, bigger. Nothing else happens (almost).

Live at https://anoma.ly/labs/hokum-anomaly/

- `public/`: the page. Plain HTML, CSS and JS, no dependencies, no images; fonts copied from `site/assets/`.
- `worker.ts`, `wrangler.jsonc`: the `hokum-hero-anomaly` Worker serving `public/` under
  `/labs/hokum-anomaly/` on anoma.ly. Deploy with `wrangler deploy` from this directory.

Cards can be dragged, flung (any direction, or right past a third of their width) and dismissed
with × or their buttons at any time; the script carries on. The second idea really does run away
from your cursor. With `prefers-reduced-motion` nothing moves: same script, cards appear in place,
the fight is a still heap and the command fades out and back.

`?t=<ms>` starts the script at that time, for checking a moment without waiting.

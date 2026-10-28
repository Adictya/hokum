# Hero prototype: the story

One man's notifications, in Capsule cards, from a $40 pizza dispute to the Moon. The script is data in
`public/labs/hokum-story/story.js`; `hero.js` renders the cards, springs the stack and handles
drag/fling/dismiss. No build step, no dependencies.

- Preview: serve `public/` and open `/labs/hokum-story/` (`?t=60` starts 60 s in).
- Deploy: `npx wrangler deploy` (Worker `hokum-hero-story`, route `anoma.ly/labs/hokum-story*`).

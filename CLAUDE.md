# Trajectory: notes for coding agents

## House rules
- **Never use em dashes or en dashes** anywhere: copy, code, comments, docs, commit messages. Restructure with a comma, colon, semicolon, parentheses, or two sentences. `test/unit/house-rules.test.js` enforces it.
- Meckman Design System V4, dark only. Tokens live in `public/styles.css` `:root` (copied from axle-alignment-pucks). 70% black, 20% charcoal, 8% white and gray, 2% tan and red.
- **One red accent per view.** In the clip workspace, red is the fitted arc on the video. Charts use tan, white and gray.
- Labels start with an action word (Load Video, Set Scale, Track Motion, Fit Arc, Save Shot). Decisions end in Go, Save, Start, Close.
- Touch targets at least 44px. No browser `alert`/`confirm` dialogs; use the modal or a two-tap confirm.
- Vanilla HTML, CSS and ES modules. No build step. New libraries are pinned into `public/vendor/` and added to the import map in `index.html`.
- Videos never leave the browser. Do not add analytics or uploads without updating the privacy page.

## Layout
- `public/js/physics`, `tracking`, `tuning` are pure modules with no DOM, tested in Node.
- `public/js/ui` holds the screens; `public/app.js` is the shell and router; `public/js/state.js` is the shared state.
- `public/js/demo/synth.js` renders synthetic footage with a known answer; tests and the Try Sample Shot button both use it.

## Before you finish
`npm test` and `npm run e2e` must pass. Deploy with `npx wrangler deploy` (static-assets Worker, custom domain in `wrangler.jsonc`).

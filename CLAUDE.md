# CLAUDE.md — CalChat

Guidance for Claude Code when working in this repo.

## What this is

**CalChat** is a **personal** PWA (just for the owner, Logan — not a public product) that lets him:
- Chat in plain text with Claude.
- Attach/paste photos & screenshots (e.g. a ticket) and have events extracted from them.
- Manage **Google Calendar across multiple Google accounts and multiple calendars** by natural language ("lunch with Elmo at 2pm Wednesday", "what's my schedule this week?").

It is a **build-free static web app** — plain HTML/CSS/JS, no npm, no bundler, no framework. Hosted on **GitHub Pages** (repo `Lekerashi/calchat`, public, deploys from `master`). The public repo is safe **only because no secrets live in code** — keys are entered at runtime and stored in the browser.

## Architecture

Everything runs client-side in the browser. There is no backend.

| File | Role |
|------|------|
| `index.html` | App shell. Loads GIS script. Tool row (📷, 🎤EN, 🎤JP) above the input row. Settings sheet (API key, model, Client ID, Connect/Refresh, Force update, version stamp). **Asset URLs are version-stamped** (`?v=N`) for cache-busting. |
| `styles.css` | Mobile-first dark theme. |
| `claude.js` | `Claude` object — reads key/model from localStorage; defines the calendar **tools**; `call(messages, system)` POSTs to the Anthropic Messages API directly from the browser. |
| `google.js` | `Google` object — GIS OAuth (multi-account), token refresh, Calendar REST (list/create/delete/list-events), calendar refs. |
| `app.js` | UI, the chat/tool loop, system-prompt builder, emoji-bookend logic, voice input, SW registration, version stamp. |
| `sw.js` | Service worker — **network-first, no precache**. |
| `manifest.webmanifest`, `icons/` | PWA install metadata + icon. |
| `README.md` | End-user setup (GitHub Pages, Google Cloud OAuth, phone config). |

### Claude integration (`claude.js`)
- Endpoint `https://api.anthropic.com/v1/messages`. Headers: `x-api-key`, `anthropic-version: 2023-06-01`, and **`anthropic-dangerous-direct-browser-access: true`** (required for browser calls).
- Default model `claude-opus-4-8`; selectable: `claude-sonnet-4-6`, `claude-haiku-4-5`. `max_tokens: 4096`. No extended thinking.
- **Tool-use loop** (`app.js` `send()`): call → if `stop_reason === 'tool_use'`, run each tool, push `tool_result` blocks, repeat (guard caps at 8 iterations).
- **Tools:** `list_calendars`, `create_event`, `list_events`, `delete_event`. `create_event.people` is an enum `['logan','yuko','shane']` driving the emoji convention.
- **Vision:** images sent as `{type:'image', source:{type:'base64', media_type, data}}` content blocks.

### Google integration (`google.js`)
- Google Identity Services token model (`initTokenClient`), scope `https://www.googleapis.com/auth/calendar`.
- **Multi-account:** each account keyed by its primary calendar id (= email). Connect each separately (`connectAccount` uses `prompt:'select_account'`).
- Tokens are short-lived (~3500s); **silent refresh** via `requestToken({email, prompt:''})`; `apiFetch` retries once on 401.
- **Calendar refs** are encoded `email||calendarId` (see `parseRef`). `listAllCalendars()` flattens all accounts; `eventsForCalendars()` merges+sorts across calendars for schedule queries.

### State (localStorage only)
`cc_api_key`, `cc_model`, `cc_client_id`, `cc_accounts`. Nothing is ever sent to a server we control. **Never commit secrets.**

## Domain conventions (don't break these)

- **Timezones:** an event's zone is the zone of its **LOCATION**, not the device. "Lunch in Denver at 2pm" while the device is in Japan → `2026-...T14:00:00` + `America/Denver`, NOT converted to device time. Times are passed to Google as **naive local datetime + IANA `timeZone`**; Google resolves the instant + DST. If no location implied, use device tz (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
- **All-day vs timed are distinct.** If the time is undecided/unstated, make an **all-day** event — don't invent a clock time. All-day end date is **exclusive** in Google (use `addDaysYMD(lastDay, 1)`). Use the component-math helpers `addDaysYMD` / `addHoursNaive` — never `toISOString().slice(0,10)` (it shifts the date across tz boundaries — this was a real bug).
- **Default calendar** is the shared **Logan + Yuko** calendar (matched by name containing both "logan" and "yuko"). Most events go here unless the user names another.
- **Emoji bookend convention (shared calendar only):** Logan 🦌, Yuko 🦥, Shane 🐧. Title is bookended in canonical order `['logan','yuko','shane']` as a prefix, mirrored as a suffix, so the involved members read e.g. `🦌🦥 Movie 🦥🦌`. Logan is always outermost when present. The model sets `people`; `app.js` (`bookendSummary` + idempotent `stripBookends`) does the stamping. **Do NOT put household members' names in the title** — the emoji conveys them. Only outside guests appear in titles ("Lunch with Elmo"). The convention applies **only** to the shared calendar.
- **Voice fills the box; it does NOT auto-send.** The user reviews, then taps send. (Auto-send was added and explicitly rejected — do not reintroduce it.) `webkitSpeechRecognition`, `continuous=false` + transcript rebuilt from all results each event (this combo fixes an Android duplicate-result bug that typed text ~20×). Two buttons: EN (`en-US`), JP (`ja-JP`).

## Deploying & the cache-staleness rule (important)

Stale caching was the single biggest recurring pain. The fix is a **three-part discipline — do ALL of it on every change:**
1. **Bump the version** in three places, in lockstep:
   - `app.js` → `const APP_VERSION = 'vN'`
   - `sw.js` → `const CACHE = 'calchat-vN'`
   - `index.html` → every asset URL `?v=N` (styles.css, google.js, claude.js, app.js)
2. The SW is **network-first with no precache** — never reintroduce a precache list (a single failed fetch used to wedge install and serve mixed stale files).
3. The in-app **Force update** button unregisters SWs + clears caches (keeps localStorage) then reloads — last-resort recovery.

Verify what's live after deploy (e.g. `curl` index.html and confirm it requests `app.js?v=N`, and that the served `app.js` reports `vN`).

Deploy = commit to `master` and push; GitHub Pages serves it.

## Working style (learned from this project)

- This is a **simple app** — keep changes small and correct. The owner has been burned by sloppy multi-file edits. **Read a file before editing it**; don't half-finish version bumps.
- **Don't bypass review:** voice and other user-facing actions should let the user confirm before anything irreversible (sending, creating).
- Git commits: end the message with
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
  and commit with `-c commit.gpgsign=false`. Commit/push only when asked.
- `.claude/` is gitignored (see `.gitignore`).

## Known constraints / declined ideas
- There is **no supported bridge** from the Claude.ai subscription to the API — the app uses API credits (paste-your-own-key). Scraping claude.ai cookies was declined (ToS + fragile).
- Voice may not work inside the installed PWA on some Android setups — fall back to the Chrome browser tab (the mic-error note says so).

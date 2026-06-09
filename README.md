# CalChat

A personal, installable web app (PWA) where you chat in plain text with Claude, attach
photos/screenshots, and have it manage **Google Calendar across multiple accounts and
multiple calendars**.

Examples it handles:
- "I'm getting lunch with Elmo at 2pm Wednesday" → creates the event.
- Attach a screenshot of a ticket/flight/invite → it reads the details and creates the event.
- "What's my schedule Friday?" / "Am I free Tuesday morning?" → pulls from **all** your
  connected calendars and answers.

Everything runs in your phone's browser. Your Anthropic API key and Google tokens are
stored only on your device. No server, no app store.

---

## What you need (one-time)

1. An **Anthropic API key** — from https://console.anthropic.com → API Keys.
2. A free **Google Cloud OAuth Client ID** (steps below).
3. A place to host these files over **https** (GitHub Pages or Vercel — both free).

---

## Step 1 — Host the app

The app must be served over https (Google sign-in won't work from a `file://` page).

**Option A: GitHub Pages**
1. Create a new GitHub repo and upload every file in this folder (keep the structure,
   including the `icons/` folder).
2. Repo → **Settings → Pages** → Source: `main` branch, `/ (root)` → Save.
3. After a minute you'll get a URL like `https://YOURNAME.github.io/calchat/`. **Copy it** —
   you need it in Step 2.

**Option B: Vercel** — drag the folder into https://vercel.com (new project) and it gives
you a `https://….vercel.app` URL.

---

## Step 2 — Create the Google OAuth Client ID

1. Go to https://console.cloud.google.com → create a project (any name).
2. **APIs & Services → Library** → search **"Google Calendar API"** → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** → Create.
   - Fill app name + your email where required.
   - **Audience / Test users**: add the Google account(s) you'll use. (In "Testing" mode only
     listed test users can sign in — that's fine for personal use.)
   - You do **not** need Google verification for personal use.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins** → add your hosting origin from Step 1, with **no path
     and no trailing slash**, e.g. `https://YOURNAME.github.io`
     (for a project page the origin is still just the domain; a Vercel origin looks like
     `https://calchat.vercel.app`).
   - Create → **copy the Client ID** (ends in `.apps.googleusercontent.com`).

> Tip: if sign-in later fails with `redirect_uri_mismatch` or `origin` errors, the Authorized
> JavaScript origin doesn't exactly match the URL you're opening the app from.

---

## Step 3 — Configure the app on your phone

1. Open your hosting URL in **Chrome on Android**.
2. Tap **⚙ (Settings)**:
   - Paste your **Anthropic API key**.
   - Pick a **Model** (Opus = smartest, Sonnet = cheaper, Haiku = cheapest).
   - Paste your **Google OAuth Client ID**.
   - Tap **+ Connect a Google account**, pick the account, allow Calendar access.
   - Repeat **Connect** for each additional Google account.
   - Tap **Save**.
3. Tap Chrome's menu → **Add to Home screen**. Now it has its own icon and opens full-screen.

---

## Using it

- Type naturally: *"dentist next Thursday 9am on my work calendar"*.
- Tap **📷** to attach a photo, or paste a screenshot straight into the text box.
- Ask about your schedule: *"what do I have this weekend?"* — it merges all calendars.
- It confirms each change in one line. Ask it to "undo that" to delete an event it just made.

---

## Cost & privacy notes

- You pay Anthropic per use (roughly fractions of a cent per short message; images cost a bit
  more). Switch to **Sonnet** or **Haiku** in Settings to spend less.
- The app talks **directly** to api.anthropic.com and googleapis.com from your browser. Keys
  and tokens never leave your device except to those services. Because the key sits in your
  browser, keep this app to yourself and don't share the device unlocked.
- Google sign-in here uses short-lived access tokens (no long-term refresh token in the
  browser). If a calendar action ever says it needs sign-in again, it'll re-prompt — that's
  normal for a client-only app.

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell / layout |
| `styles.css` | Styling (mobile-first dark theme) |
| `app.js` | Chat UI + the Claude↔Calendar tool loop |
| `claude.js` | Claude API client + calendar tool definitions |
| `google.js` | Google sign-in (multi-account) + Calendar API |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA install + offline shell |

To swap the icon, replace `icons/icon.svg` (or add PNGs and reference them in
`manifest.webmanifest`).

/* app.js — UI, the chat/tool loop, and the bridge between Claude and Google. */

const $ = (id) => document.getElementById(id);
const messagesEl = $('messages');
const inputEl = $('input');
const thumbsEl = $('thumbs');

// API-format conversation history (what we send to Claude each turn).
let history = [];
// Images the user has attached to the *next* message: {media_type, data, url}
let pending = [];

/* ---------- rendering ---------- */
function bubble(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'me' : 'ai');
  div.textContent = text;
  messagesEl.appendChild(div);
  scroll();
  return div;
}
function note(text, cls = '') {
  const div = document.createElement('div');
  div.className = 'note ' + cls;
  div.textContent = text;
  messagesEl.appendChild(div);
  scroll();
  return div;
}
function scroll() { messagesEl.scrollTop = messagesEl.scrollHeight; }

function renderUserMessage(text, imgs) {
  const div = document.createElement('div');
  div.className = 'msg me';
  if (text) div.appendChild(document.createTextNode(text));
  for (const im of imgs) {
    const img = document.createElement('img');
    img.src = im.url;
    div.appendChild(img);
  }
  messagesEl.appendChild(div);
  scroll();
}

/* ---------- system prompt (rebuilt each send so date/calendars are fresh) ---------- */
function buildSystem() {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const cals = Google.listAllCalendars();
  const calLines = cals.length
    ? cals.map(c => `- ${c.name}${c.primary ? ' (primary)' : ''} — account ${c.account} — ref: ${c.ref}`).join('\n')
    : '(no calendars connected yet — tell the user to open Settings ⚙ and connect a Google account)';

  return [
    'You are CalChat, a friendly assistant that manages the user\'s Google Calendar through tools.',
    `The current date and time is ${now.toString()} (ISO: ${now.toISOString()}).`,
    `The user\'s device timezone is ${tz}. Resolve relative dates like "Wednesday" or "tomorrow" against the current date in this timezone.`,
    'Important about timezones: an event\'s timezone is the timezone of its LOCATION, which may differ from the device timezone. If the user names a place (e.g. "lunch in Denver next Sunday at 2pm") while their device is elsewhere (e.g. Japan), create the event at that local clock time in the location\'s zone (2pm America/Denver) — do not convert it to the device timezone. If no location is implied, use the device timezone.',
    '',
    'Connected calendars:',
    calLines,
    '',
    'Guidelines:',
    '- When the user describes a plan in plain language ("lunch with Elmo at 2pm Wednesday"), create the event with create_event.',
    '- If a time is given or clearly implied, make a timed event. If the time is undecided/unstated and not obvious, make it an all-day event rather than inventing a clock time or asking.',
    '- When the user attaches a screenshot/photo of a ticket, flight, invite, etc., read the date, time, title and location from the image and create the event.',
    '- When a venue or address is given, put it in the create_event `location` field ONLY — do NOT repeat it in the title (no "Dinner at Joe\'s Diner"). Keep `summary` to the event itself ("Dinner"); the location field already carries the where.',
    '- For "what\'s my schedule" / "am I free" questions, call list_events with NO refs so it pulls from every connected calendar, using a sensible time_min/time_max window.',
    '- Choosing a calendar: if the user names one (e.g. "work"), match it. Otherwise DEFAULT to the shared Logan + Yuko calendar — that is the user\'s preferred default.',
    '- After creating, changing, or deleting an event, confirm in one short sentence what you did (title, date, time, which calendar).',
    '- Be concise. Do not narrate routine steps or restate these instructions.',
    '',
    'People & the shared calendar:',
    '- The user is Logan. Yuko is Logan\'s wife. They share a calendar whose name contains both their names (the "Logan + Yuko" calendar). Shane is another person they track.',
    '- Whenever you create an event ON that shared calendar, set the create_event `people` field to whichever household members the event is for, using keys: logan, yuko, shane. The app automatically bookends the title with their emojis — you only need to identify who; give a plain `summary`.',
    '- Since the shared calendar is the default, set `people` on essentially every event unless the user explicitly chooses a different (personal) calendar.',
    '- Infer who from context: "I/me/my" → [logan]; "Yuko" / "Yuko and I" / "we/us/our" → include yuko (and logan if he is part of it); "Shane" → include shane; combinations as appropriate. An outside guest (e.g. "lunch with Elmo") is not a household member — that is still logan\'s event, so people is [logan].',
    '- Do NOT write household members\' names into the title. Their presence is conveyed by `people` and the emoji bookends. Title the event itself: "Movie" (not "Movie with Yuko"), "Dinner" (not "Dinner with Yuko and Shane"). Only non-household guests may appear in the title text, e.g. "Lunch with Elmo".',
    '- This emoji convention applies ONLY to the shared calendar. For any other calendar, do not set people.',
  ].join('\n');
}

/* ---------- helpers ---------- */
// Add n days to a YYYY-MM-DD string without any timezone conversion.
function addDaysYMD(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

// Add hours to a local datetime string, keeping it "naive" (no offset) so the
// event's own timezone — not the device's — defines the instant.
function addHoursNaive(dtStr, hours) {
  const m = dtStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + hours, +m[5], +(m[6] || 0)));
  const p = (x) => String(x).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}` +
         `T${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:${p(dt.getUTCSeconds())}`;
}

/* ---------- shared Logan + Yuko calendar: emoji bookend convention ----------
 * Events on the shared calendar get their title bookended with each household
 * member's emoji — canonical order as a prefix, mirrored as a suffix, so Logan
 * is always first and last when involved. Easy to edit if names/emoji change. */
const SHARED_CAL = {
  // A connected calendar counts as "the shared calendar" if its name matches this.
  match: (name) => /logan/i.test(name) && /yuko/i.test(name),
  order: ['logan', 'yuko', 'shane'],         // canonical ordering
  emoji: { logan: '🦌', yuko: '🦥', shane: '🐧' },
};

// Remove any existing bookend emoji/spaces so re-stamping is idempotent.
function stripBookends(s) {
  const set = new Set(Object.values(SHARED_CAL.emoji));
  const chars = [...s.trim()];
  let a = 0, b = chars.length;
  while (a < b && (set.has(chars[a]) || chars[a] === ' ')) a++;
  while (b > a && (set.has(chars[b - 1]) || chars[b - 1] === ' ')) b--;
  return chars.slice(a, b).join('').trim();
}

function bookendSummary(summary, people) {
  const present = SHARED_CAL.order.filter((p) => (people || []).includes(p));
  if (!present.length) return summary;
  const pre = present.map((p) => SHARED_CAL.emoji[p]).join('');
  const suf = present.slice().reverse().map((p) => SHARED_CAL.emoji[p]).join('');
  return `${pre} ${stripBookends(summary)} ${suf}`;
}

/* ---------- tool execution ---------- */
async function runTool(name, input) {
  if (name === 'list_calendars') {
    const cals = Google.listAllCalendars();
    return cals.length ? cals : 'No calendars connected. Ask the user to connect a Google account in Settings.';
  }

  if (name === 'create_event') {
    let ref = input.ref;
    if (!ref) {
      // Default to the shared Logan + Yuko calendar; fall back to a primary calendar.
      const cals = Google.listAllCalendars();
      const target = cals.find(c => SHARED_CAL.match(c.name)) || cals.find(c => c.primary) || cals[0];
      if (!target) return 'No calendar available. Ask the user to connect a Google account first.';
      ref = target.ref;
    }
    const tz = input.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

    // On the shared Logan + Yuko calendar, bookend the title with member emojis.
    let summary = input.summary;
    const calInfo = Google.listAllCalendars().find((c) => c.ref === ref);
    if (calInfo && SHARED_CAL.match(calInfo.name) && input.people && input.people.length) {
      summary = bookendSummary(summary, input.people);
    }

    let body = { summary };
    if (input.location) body.location = input.location;
    if (input.description) body.description = input.description;

    if (input.all_day || (input.start_date && !input.start_datetime)) {
      const start = input.start_date;
      // Google's all-day end date is exclusive (= the day after the last day).
      const lastDay = input.end_date || start;
      body.start = { date: start };
      body.end = { date: addDaysYMD(lastDay, 1) };
    } else {
      const start = input.start_datetime;
      const end = input.end_datetime || addHoursNaive(start, 1) || start;
      body.start = { dateTime: start, timeZone: tz };
      body.end = { dateTime: end, timeZone: tz };
    }
    const created = await Google.createEvent(ref, body);
    note('📅 Added: ' + (created.summary || input.summary), 'tool');
    return { ok: true, id: created.id, ref, htmlLink: created.htmlLink, summary: created.summary, start: created.start, end: created.end };
  }

  if (name === 'list_events') {
    const refs = (input.refs && input.refs.length)
      ? input.refs
      : Google.listAllCalendars().map(c => c.ref);
    if (!refs.length) return 'No calendars connected.';
    const events = await Google.eventsForCalendars(refs, input.time_min, input.time_max);
    return { count: events.length, events };
  }

  if (name === 'delete_event') {
    await Google.deleteEvent(input.ref, input.id);
    note('🗑 Deleted event', 'tool');
    return { ok: true };
  }

  return 'Unknown tool: ' + name;
}

/* ---------- main send loop ---------- */
let busy = false;
async function send() {
  if (busy) return;
  const text = inputEl.value.trim();
  const imgs = pending.slice();
  if (!text && !imgs.length) return;

  // Build the user message content blocks for the API.
  const content = [];
  for (const im of imgs) {
    content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } });
  }
  if (text) content.push({ type: 'text', text });

  renderUserMessage(text, imgs);
  history.push({ role: 'user', content });
  inputEl.value = '';
  inputEl.style.height = 'auto';
  pending = [];
  renderThumbs();

  busy = true;
  const typing = note('…', 'typing');
  try {
    let guard = 0;
    while (guard++ < 8) {
      const resp = await Claude.call(history, buildSystem());
      history.push({ role: 'assistant', content: resp.content });

      // Render any text the model produced.
      for (const block of resp.content) {
        if (block.type === 'text' && block.text.trim()) bubble('assistant', block.text.trim());
      }

      if (resp.stop_reason !== 'tool_use') break;

      // Execute every tool call and feed the results back.
      const toolResults = [];
      for (const block of resp.content) {
        if (block.type !== 'tool_use') continue;
        let result;
        try {
          result = await runTool(block.name, block.input || {});
        } catch (e) {
          result = 'Error: ' + (e.message || e);
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }
      history.push({ role: 'user', content: toolResults });
    }
  } catch (e) {
    bubble('assistant', '⚠ ' + (e.message || e));
  } finally {
    typing.remove();
    busy = false;
  }
}

/* ---------- image attachment ---------- */
function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result; // data:image/png;base64,XXXX
      const comma = dataUrl.indexOf(',');
      const meta = dataUrl.slice(5, comma); // image/png;base64
      const media_type = meta.split(';')[0];
      resolve({ media_type, data: dataUrl.slice(comma + 1), url: dataUrl });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function addFiles(files) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    pending.push(await fileToImage(f));
  }
  renderThumbs();
}
function renderThumbs() {
  thumbsEl.innerHTML = '';
  pending.forEach((im, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'thumb';
    const img = document.createElement('img');
    img.src = im.url;
    const x = document.createElement('div');
    x.className = 'x';
    x.textContent = '✕';
    x.onclick = () => { pending.splice(i, 1); renderThumbs(); };
    wrap.append(img, x);
    thumbsEl.appendChild(wrap);
  });
}

/* ---------- settings ---------- */
function renderAccounts() {
  const list = $('accountsList');
  list.innerHTML = '';
  for (const [email, a] of Object.entries(Google.accounts)) {
    const div = document.createElement('div');
    div.className = 'account';
    const calNames = a.calendars.map(c => c.name).join(', ');
    div.innerHTML =
      `<div class="email">${email} <span style="float:right;cursor:pointer;color:#9aa3b2" data-rm="${email}">remove</span></div>` +
      `<div class="cals">${a.calendars.length} calendars: ${calNames}</div>`;
    list.appendChild(div);
  }
  list.querySelectorAll('[data-rm]').forEach(el => {
    el.onclick = () => { Google.removeAccount(el.getAttribute('data-rm')); renderAccounts(); };
  });
}
function openSettings() {
  $('apiKeyInput').value = Claude.apiKey;
  $('modelSelect').value = Claude.model;
  $('clientIdInput').value = Google.clientId || '';
  renderAccounts();
  $('settingsOverlay').classList.remove('hidden');
}
function saveSettings() {
  localStorage.setItem('cc_api_key', $('apiKeyInput').value.trim());
  localStorage.setItem('cc_model', $('modelSelect').value);
  const cid = $('clientIdInput').value.trim();
  localStorage.setItem('cc_client_id', cid);
  Google.clientId = cid || null;
  Google.ready = false; // re-init with the new client id on next use
  $('settingsOverlay').classList.add('hidden');
}

/* ---------- wiring ---------- */
$('composer').addEventListener('submit', (e) => { e.preventDefault(); send(); });
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
});
$('fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
// Paste a screenshot directly into the box.
inputEl.addEventListener('paste', (e) => {
  const items = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/'));
  if (items.length) { addFiles(items.map(i => i.getAsFile())); e.preventDefault(); }
});

$('settingsBtn').onclick = openSettings;
$('closeSettings').onclick = () => $('settingsOverlay').classList.add('hidden');
$('saveSettings').onclick = saveSettings;
$('connectGoogle').onclick = async () => {
  // Save the client id first so init() can use it.
  const cid = $('clientIdInput').value.trim();
  if (cid) { localStorage.setItem('cc_client_id', cid); Google.clientId = cid; Google.ready = false; }
  try {
    await Google.connectAccount();
    renderAccounts();
  } catch (e) {
    alert('Could not connect: ' + (e.message || e));
  }
};
$('refreshCals').onclick = async () => {
  try { await Google.refreshAllCalendars(); renderAccounts(); }
  catch (e) { alert('Refresh failed: ' + (e.message || e)); }
};
$('forceUpdate').onclick = async () => {
  // Clear stuck service workers + caches, then reload — keeps localStorage (your keys).
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) { /* ignore */ }
  location.reload();
};

/* ---------- voice input (speech-to-text) — English + Japanese ---------- */
(function setupMic() {
  const btnEn = $('micEn'), btnJa = $('micJa');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { btnEn.style.display = 'none'; btnJa.style.display = 'none'; return; }
  const rec = new SR();
  rec.interimResults = true;
  rec.continuous = false; // single utterance — avoids the Android duplicate-result bug
  let listening = false, base = '', activeBtn = null;

  rec.onresult = (e) => {
    // Rebuild the whole transcript from all results each event (idempotent — never repeats).
    let txt = '';
    for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
    inputEl.value = ((base ? base + ' ' : '') + txt).trim();
    inputEl.dispatchEvent(new Event('input')); // resize the box — you review, then tap send
  };
  const clear = () => { listening = false; if (activeBtn) activeBtn.classList.remove('rec'); activeBtn = null; };
  rec.onend = clear; // fill the box only; do NOT auto-send
  rec.onerror = (e) => {
    clear();
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
      note('🎤 Mic blocked. Allow microphone access. (Voice may not work in the installed app — try the Chrome browser tab.)');
    else if (e.error !== 'no-speech' && e.error !== 'aborted')
      note('🎤 voice error: ' + e.error);
  };

  function listen(lang, btn) {
    if (listening) { rec.stop(); return; } // tapping either button while live stops it
    rec.lang = lang;
    base = inputEl.value.trim();
    activeBtn = btn; listening = true; btn.classList.add('rec'); inputEl.focus(); // instant feedback
    try { rec.start(); }
    catch (err) { clear(); note('🎤 couldn’t start: ' + ((err && err.message) || err)); }
  }
  btnEn.onclick = () => listen('en-US', btnEn);
  btnJa.onclick = () => listen('ja-JP', btnJa);
})();

/* First-run hint — only until both the API key and a Google account are set up. */
if (!Claude.apiKey || Object.keys(Google.accounts).length === 0) {
  note('Welcome! Open Settings ⚙ to add your Claude API key and connect Google Calendar.');
}

/* Version stamp (shown in Settings) — bump on each deploy so we can confirm what's live. */
const APP_VERSION = 'v13';
{ const v = $('ver'); if (v) v.textContent = APP_VERSION; }

/* PWA service worker — register, check for updates, and auto-reload when a new one takes over. */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => reg.update())
    .catch(() => {});
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
}

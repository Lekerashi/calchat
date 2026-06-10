/* google.js — Google sign-in (multiple accounts) + Calendar API, all client-side.
 *
 * Uses Google Identity Services (GIS) token model. Each connected account stores
 * its own short-lived access token; tokens are silently refreshed when they expire.
 * Calendars from every account are exposed to the AI through a single combined list.
 */
const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar';

const Google = {
  clientId: null,
  tokenClient: null,
  ready: false,
  // email -> { token, expiresAt, calendars: [{id, name, primary}] }
  accounts: {},

  load() {
    this.clientId = localStorage.getItem('cc_client_id') || null;
    try { this.accounts = JSON.parse(localStorage.getItem('cc_accounts') || '{}'); }
    catch { this.accounts = {}; }
  },

  persist() {
    localStorage.setItem('cc_accounts', JSON.stringify(this.accounts));
  },

  init() {
    // Requires the GIS script to have loaded and a client ID to be set.
    if (this.ready) return true;
    if (!this.clientId) return false;
    if (!(window.google && google.accounts && google.accounts.oauth2)) return false;
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: CAL_SCOPE,
      callback: () => {}, // replaced per-request
    });
    this.ready = true;
    return true;
  },

  requestToken({ email = null, prompt = '' } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.init()) return reject(new Error('Google not configured. Add an OAuth Client ID in Settings.'));
      this.tokenClient.callback = (resp) => {
        if (resp && resp.access_token) resolve(resp.access_token);
        else reject(new Error(resp && resp.error ? resp.error : 'authorization failed'));
      };
      const cfg = { prompt };
      if (email) cfg.hint = email;
      this.tokenClient.requestAccessToken(cfg);
    });
  },

  // Interactive: let the user pick which account to add.
  async connectAccount() {
    const token = await this.requestToken({ prompt: 'select_account' });
    const cals = await this.fetchCalendars(token);
    const primary = cals.find(c => c.primary) || cals[0];
    const email = primary ? primary.id : ('account-' + (Object.keys(this.accounts).length + 1));
    this.accounts[email] = {
      token,
      expiresAt: Date.now() + 3500 * 1000,
      calendars: cals.map(c => ({ id: c.id, name: c.summary, primary: !!c.primary })),
    };
    this.persist();
    return email;
  },

  removeAccount(email) {
    delete this.accounts[email];
    this.persist();
  },

  async validToken(email) {
    const a = this.accounts[email];
    if (!a) throw new Error('Account not connected: ' + email);
    if (!a.token || Date.now() > a.expiresAt - 60000) {
      a.token = await this.requestToken({ email, prompt: '' }); // silent refresh
      a.expiresAt = Date.now() + 3500 * 1000;
      this.persist();
    }
    return a.token;
  },

  async fetchCalendars(token) {
    const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) throw new Error('calendarList ' + res.status);
    return (await res.json()).items || [];
  },

  async refreshAllCalendars() {
    for (const email of Object.keys(this.accounts)) {
      const token = await this.validToken(email);
      const cals = await this.fetchCalendars(token);
      this.accounts[email].calendars = cals.map(c => ({ id: c.id, name: c.summary, primary: !!c.primary }));
    }
    this.persist();
  },

  // Flat list of every calendar across every account, each with a stable ref.
  listAllCalendars() {
    const out = [];
    for (const [email, a] of Object.entries(this.accounts)) {
      for (const c of a.calendars) {
        out.push({ ref: email + '||' + c.id, account: email, name: c.name, primary: c.primary });
      }
    }
    return out;
  },

  parseRef(ref) {
    const i = ref.indexOf('||');
    return { email: ref.slice(0, i), calendarId: ref.slice(i + 2) };
  },

  async apiFetch(email, url, opts = {}) {
    const token = await this.validToken(email);
    opts.headers = Object.assign({}, opts.headers, { Authorization: 'Bearer ' + token });
    let res = await this._fetchTimeout(url, opts);
    if (res.status === 401) { // token rejected — force one refresh and retry
      this.accounts[email].expiresAt = 0;
      opts.headers.Authorization = 'Bearer ' + (await this.validToken(email));
      res = await this._fetchTimeout(url, opts);
    }
    return res;
  },

  // fetch that aborts after 30s — a hung calendar request must not freeze the chat.
  async _fetchTimeout(url, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Google Calendar request timed out.');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  },

  async createEvent(ref, body) {
    const { email, calendarId } = this.parseRef(ref);
    const res = await this.apiFetch(email,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error('create ' + res.status + ': ' + (await res.text()));
    return await res.json();
  },

  async deleteEvent(ref, eventId) {
    const { email, calendarId } = this.parseRef(ref);
    const res = await this.apiFetch(email,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' });
    if (!res.ok && res.status !== 410) throw new Error('delete ' + res.status);
    return true;
  },

  // Events for one calendar.
  async eventsForCalendar(ref, timeMin, timeMax) {
    const { email, calendarId } = this.parseRef(ref);
    const params = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: '100' });
    if (timeMin) params.set('timeMin', timeMin);
    if (timeMax) params.set('timeMax', timeMax);
    const res = await this.apiFetch(email,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?` + params);
    if (!res.ok) throw new Error('list ' + res.status);
    return (await res.json()).items || [];
  },

  // Events across MANY calendars, merged and sorted — used for "what's my schedule?".
  async eventsForCalendars(refs, timeMin, timeMax) {
    const all = [];
    await Promise.all(refs.map(async (ref) => {
      const cal = this.listAllCalendars().find(c => c.ref === ref);
      try {
        const items = await this.eventsForCalendar(ref, timeMin, timeMax);
        for (const ev of items) {
          all.push({
            calendar: cal ? `${cal.name} (${cal.account})` : ref,
            summary: ev.summary || '(no title)',
            start: ev.start && (ev.start.dateTime || ev.start.date),
            end: ev.end && (ev.end.dateTime || ev.end.date),
            location: ev.location || undefined,
            id: ev.id,
            ref,
          });
        }
      } catch (e) {
        all.push({ calendar: cal ? cal.name : ref, error: String(e.message || e) });
      }
    }));
    all.sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
    return all;
  },
};

Google.load();

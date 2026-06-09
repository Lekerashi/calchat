/* claude.js — Calls the Claude API directly from the browser and defines the
 * calendar "tools" the model is allowed to use.
 *
 * Anthropic allows direct browser calls when the special header below is sent.
 * Your API key lives only in this browser's localStorage.
 */
const Claude = {
  get apiKey() { return localStorage.getItem('cc_api_key') || ''; },
  get model() { return localStorage.getItem('cc_model') || 'claude-opus-4-8'; },

  tools: [
    {
      name: 'list_calendars',
      description:
        'List every calendar the user has connected, across all of their Google accounts. ' +
        'Returns each calendar with a "ref" you must use when creating events or listing events. ' +
        'Call this first if you do not yet know the available calendars.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'create_event',
      description:
        'Create a calendar event. Choose ONE of two distinct kinds:\n' +
        '- TIMED event: set start_datetime (+ optional end_datetime) AND timezone. all_day must be false/omitted.\n' +
        '- ALL-DAY event: set all_day:true and start_date (+ optional end_date). Do NOT set times or timezone.\n' +
        'For a timed event, give the wall-clock time as a plain local datetime WITHOUT an offset ' +
        '(e.g. 2026-06-14T14:00:00) and put the IANA zone in `timezone`; Google resolves the exact ' +
        'instant and daylight saving. The timezone must be the zone of the event LOCATION. If the ' +
        'user names a place in a different region than their device (e.g. "lunch in Denver" while ' +
        'the device is in Japan), use that location\'s zone (America/Denver) and that local clock ' +
        'time — NOT the device timezone. If no location is implied, use the user\'s device timezone. ' +
        'If end is omitted, a timed event defaults to 1 hour and an all-day event to a single day.',
      input_schema: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Calendar ref from list_calendars. If omitted, the user\'s primary calendar is used.' },
          summary: { type: 'string', description: 'Event title.' },
          all_day: { type: 'boolean', description: 'True ONLY for all-day events. Omit/false for timed events.' },
          start_datetime: { type: 'string', description: 'Timed events: local start, no offset, e.g. 2026-06-14T14:00:00. The `timezone` field defines the zone.' },
          end_datetime: { type: 'string', description: 'Timed events: local end, no offset. Optional (defaults to 1 hour after start).' },
          start_date: { type: 'string', description: 'All-day events: YYYY-MM-DD start.' },
          end_date: { type: 'string', description: 'All-day events: YYYY-MM-DD last day, inclusive. Optional.' },
          timezone: { type: 'string', description: 'Timed events only: IANA zone of the event location, e.g. America/Denver or Asia/Tokyo.' },
          location: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['summary'],
      },
    },
    {
      name: 'list_events',
      description:
        'List events to answer questions about the user\'s schedule. By default this pulls from ' +
        'ALL connected calendars across ALL accounts and merges them in time order — use that for ' +
        '"what\'s my schedule" type questions. Optionally restrict to specific calendar refs. ' +
        'Provide an ISO time_min and time_max that bound the window you care about.',
      input_schema: {
        type: 'object',
        properties: {
          refs: { type: 'array', items: { type: 'string' }, description: 'Optional list of calendar refs. Omit for all calendars.' },
          time_min: { type: 'string', description: 'ISO 8601 lower bound (inclusive).' },
          time_max: { type: 'string', description: 'ISO 8601 upper bound (exclusive).' },
        },
      },
    },
    {
      name: 'delete_event',
      description: 'Delete an event by its ref (the calendar it lives on) and id. Use to undo an event you just created.',
      input_schema: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          id: { type: 'string' },
        },
        required: ['ref', 'id'],
      },
    },
  ],

  async call(messages, system) {
    if (!this.apiKey) throw new Error('Add your Anthropic API key in Settings (⚙).');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system,
        tools: this.tools,
        messages,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error('Claude API ' + res.status + ': ' + text);
    }
    return await res.json();
  },
};

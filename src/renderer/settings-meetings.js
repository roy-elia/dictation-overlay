'use strict';
(() => {
  const rf = window.royflow;
  const { TABS, h, header, row, toggle, status, set, fmtDate, render } = window.rfSettings;
  let openId = null, busy = null, err = null;

  // Minimal, safe Markdown -> DOM for the summary (headings, bullets, checkboxes, bold).
  function md(text) {
    const root = h('div', { class: 'md' });
    let list = null;
    for (const line of (text || '').split('\n')) {
      const inline = (t) => t.split(/(\*\*[^*]+\*\*)/).map((p) => (p.startsWith('**') ? h('b', {}, p.slice(2, -2)) : p));
      if (/^#{1,3}\s/.test(line)) { list = null; root.append(h('h3', { style: 'margin:14px 0 6px;font-size:14px' }, inline(line.replace(/^#+\s*/, '')))); continue; }
      const li = /^\s*[-*]\s+(\[( |x)\]\s+)?(.*)$/.exec(line);
      if (li) {
        if (!list) { list = h('ul', { style: 'margin:0 0 6px;padding-left:20px' }); root.append(list); }
        list.append(h('li', {}, li[1] ? (li[2] === 'x' ? '☑ ' : '☐ ') : '', inline(li[3])));
        continue;
      }
      list = null;
      if (line.trim()) root.append(h('p', { style: 'margin:0 0 8px' }, inline(line)));
    }
    return root;
  }

  const dur = (m) => (m.ended_at ? `${Math.max(1, Math.round((m.ended_at - m.started_at) / 60000))} min` : 'recording…');
  const clean = (e) => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  async function detail(id) {
    const m = await rf.call('meetings:get', id);
    if (!m) { openId = null; return list(); }
    const title = h('input', { type: 'text', value: m.title, style: 'font-size:18px;font-weight:700;width:100%;background:transparent;border-color:transparent' });
    title.addEventListener('change', () => rf.call('meetings:rename', id, title.value));
    const summarize = async () => {
      busy = 'Summarizing…'; err = null; render();
      try { await rf.call('meetings:summarize', id); } catch (e) { err = clean(e); }
      busy = null; render();
    };
    return [
      h('button', { onclick: () => { openId = null; render(); } }, '‹ All meetings'),
      h('div', { style: 'height:14px' }), title,
      h('p', { class: 'sub' }, `${fmtDate(m.started_at)} · ${dur(m)}`),
      h('div', { class: 'toolbar' },
        h('button', { class: 'primary', onclick: summarize, disabled: !!busy || !m.ended_at }, m.summary ? 'Re-summarize' : 'Summarize with Claude'),
        h('button', { onclick: () => rf.call('meetings:export', id) }, 'Export Markdown'),
        h('button', { onclick: () => rf.call('meetings:copy', `${m.summary || ''}\n\n${m.transcript}`) }, 'Copy All'),
        h('button', { class: 'danger', onclick: async () => { if (confirm('Delete this meeting?')) { await rf.call('meetings:delete', id); openId = null; render(); } } }, 'Delete')),
      busy ? h('p', { class: 'note' }, busy) : null,
      err ? h('p', { class: 'note', style: 'color:var(--bad)' }, err) : null,
      h('h2', {}, 'Notes'),
      h('div', { class: 'card', style: 'padding:14px' }, m.summary ? md(m.summary) : h('div', { class: 'empty', style: 'padding:6px' }, m.ended_at ? 'No summary yet.' : 'Notes appear when the meeting ends.')),
      h('h2', {}, 'Transcript'),
      h('div', { class: 'card', style: 'padding:14px;white-space:pre-wrap;font-size:12.5px;line-height:1.6' }, m.transcript || 'Nothing transcribed yet. Text appears every ~30 seconds.'),
    ];
  }

  async function list() {
    const S = window.rfSettings.S;
    const [st, items, ai] = await Promise.all([rf.call('meetings:status'), rf.call('meetings:list'), rf.call('ai:status')]);
    const startStop = st.active
      ? h('button', { class: 'danger', onclick: async () => { await rf.call('meetings:stop'); render(); } }, 'Stop Recording')
      : h('button', { class: 'primary', onclick: async () => {
        err = null;
        try { await rf.call('meetings:start'); } catch (e) { err = clean(e); }
        render();
      } }, 'Start Meeting Notes');

    return [
      ...header('Meetings', 'Record a call, get a transcript on this Mac, and notes from Claude when it ends.'),
      h('div', { class: 'card' },
        row(st.active ? 'Recording now' : 'Not recording',
          st.active ? `Since ${new Date(st.startedAt).toLocaleTimeString()}${st.systemAudio ? ' · your mic + system audio' : ' · your mic only'}` : 'Or use the menu bar.',
          startStop)),
      err ? h('p', { class: 'note', style: 'color:var(--bad)' }, err) : null,

      h('h2', {}, 'Options'),
      h('div', { class: 'card' },
        row('Record other participants', 'Captures system audio (Zoom, Meet, Teams…). Needs Screen Recording permission.', toggle(S.meetingSystemAudio !== false, (v) => set('meetingSystemAudio', v))),
        row('Write notes when the meeting ends', ai.configured ? 'Sends the transcript to Claude.' : 'Needs a Claude API key (AI Polish tab).',
          ai.configured ? toggle(S.meetingAutoSummary !== false, (v) => set('meetingAutoSummary', v)) : status('warn', 'Not set up'))),

      h('h2', {}, `Recorded · ${items.length}`),
      h('div', { class: 'card' },
        items.length
          ? items.map((m) => h('div', { class: 'item', style: 'cursor:pointer', onclick: () => { openId = m.id; render(); } },
            h('div', {}, h('b', {}, m.title), h('div', { class: 'meta' }, `${fmtDate(m.started_at)} · ${dur(m)}${m.has_summary ? ' · notes' : ''}`)),
            h('div', { class: 'actions' }, '›')))
          : h('div', { class: 'empty' }, 'No meetings yet.')),
    ];
  }

  TABS.meetings = () => (openId ? detail(openId) : list());
  rf.on('ev:meetings', () => { if (document.querySelector('nav a.on')?.dataset.tab === 'meetings') render(); });
})();

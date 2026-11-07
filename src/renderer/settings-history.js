'use strict';
(() => {
  const rf = window.royflow;
  const { TABS, h, header, row, select, set, fmtDate, render } = window.rfSettings;
  let term = '';

  TABS.history = async () => {
    const S = window.rfSettings.S;
    const [stats, items] = await Promise.all([rf.call('history:stats'), rf.call('history:list', term)]);
    const shown = items.filter((t) => t.text);
    const wpm = stats.seconds > 0 ? Math.round((stats.words / stats.seconds) * 60) : 0;

    const search = h('input', { type: 'text', placeholder: 'Search transcripts', value: term });
    let timer;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { term = search.value; render(); }, 250); });

    const list = shown.length
      ? shown.map((t) => h('div', { class: 'item' },
        h('div', {}, h('div', { style: 'white-space:pre-wrap' }, t.text),
          h('div', { class: 'meta' }, fmtDate(t.created_at), t.kind === 'polish' ? ' · polished' : '', t.seconds ? ` · ${t.seconds.toFixed(1)} s` : '')),
        h('div', { class: 'actions' },
          h('button', { onclick: () => rf.call('history:copy', t.text) }, 'Copy'),
          h('button', { class: 'danger', onclick: async () => { await rf.call('history:delete', t.id); render(); } }, 'Delete'))))
      : h('div', { class: 'empty' }, term ? 'Nothing matches.' : S.historyRetention === 'never' ? 'History is turned off.' : 'Nothing dictated yet.');

    return [
      ...header('History', 'Everything you’ve dictated, stored only on this Mac.'),
      h('div', { class: 'card stat' },
        h('div', {}, h('b', {}, stats.words.toLocaleString()), h('span', {}, 'words dictated')),
        h('div', {}, h('b', {}, stats.week.toLocaleString()), h('span', {}, 'this week')),
        h('div', {}, h('b', {}, stats.n.toLocaleString()), h('span', {}, 'dictations')),
        h('div', {}, h('b', {}, wpm || '—'), h('span', {}, 'words per minute'))),

      h('h2', {}, 'Privacy'),
      h('div', { class: 'card' },
        row('Keep transcripts', 'Word counts are kept either way.',
          select([['forever', 'Forever'], ['24h', 'For 24 hours'], ['never', 'Don’t keep text']], S.historyRetention,
            async (v) => { await set('historyRetention', v); render(); })),
        row('Delete all transcripts', null, h('button', { class: 'danger', onclick: async () => {
          if (confirm('Delete every saved transcript? Word counts stay.')) { await rf.call('history:clear'); render(); }
        } }, 'Delete All…'))),

      h('h2', {}, 'Transcripts'),
      h('div', { class: 'toolbar' }, search),
      h('div', { class: 'card' }, list),
    ];
  };
})();

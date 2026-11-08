'use strict';
(() => {
  const rf = window.royflow;
  const { TABS, h, header, row, select, set, fmtDate, render } = window.rfSettings;
  let term = '';

  // Word-level diff (LCS) for polish/command entries: original -> result.
  function diff(a, b) {
    const A = a.split(/(\s+)/), B = b.split(/(\s+)/);
    if (A.length * B.length > 250000) return h('div', {}, b);
    const dp = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
    for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = h('div', { class: 'diff', style: 'white-space:pre-wrap' });
    let i = 0, j = 0;
    while (i < A.length || j < B.length) {
      if (i < A.length && j < B.length && A[i] === B[j]) { out.append(A[i]); i++; j++; }
      else if (j < B.length && (i >= A.length || dp[i][j + 1] >= dp[i + 1][j])) { out.append(h('ins', {}, B[j])); j++; }
      else { out.append(h('del', {}, A[i])); i++; }
    }
    return out;
  }

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
        h('div', {}, t.kind === 'polish' && t.raw ? diff(t.raw, t.text) : h('div', { style: 'white-space:pre-wrap' }, t.text),
          t.kind === 'command' && t.raw ? h('div', { class: 'meta' }, `You said: “${t.raw}”`) : null,
          h('div', { class: 'meta' }, fmtDate(t.created_at), { polish: ' · polished', command: ' · voice command' }[t.kind] || '', t.seconds ? ` · ${t.seconds.toFixed(1)} s` : '')),
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

      h('h2', {}, 'Delete my data'),
      h('div', { class: 'card' },
        ...[['meetings', 'Meeting notes', 'Recordings’ transcripts and summaries.'],
          ['notes', 'Scratchpad notes', null],
          ['vocab', 'Dictionary & snippets', null],
          ['transcripts', 'Transcripts and stats', 'Also resets Insights and word counts.']].map(([k, t, sub]) =>
          row(t, sub, h('button', { class: 'danger', onclick: async () => {
            if (confirm(`Delete all ${t.toLowerCase()}? This can’t be undone.`)) { await rf.call('history:delete-category', k); render(); }
          } }, 'Delete…')))),
      h('p', { class: 'note' }, 'Everything RoyFlow stores lives on this Mac only. Settings and your API key are kept.'),

      h('h2', {}, 'Transcripts'),
      h('div', { class: 'toolbar' }, search),
      h('div', { class: 'card' }, list),
    ];
  };
})();

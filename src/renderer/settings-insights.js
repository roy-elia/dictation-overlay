'use strict';
// Insights: speed, streak heatmap, fixes made, and where you dictate.
(() => {
  const rf = window.royflow;
  const { TABS, h, header } = window.rfSettings;
  const WEEKS = 20;
  const TYPING_WPM = 40; // average typing speed, for the "× faster" comparison

  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function streak(byDay) {
    let n = 0;
    const d = new Date();
    if (!byDay.has(key(d))) d.setDate(d.getDate() - 1); // today not started yet doesn't break it
    while (byDay.has(key(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  function heatmap(byDay) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(today); start.setDate(start.getDate() - today.getDay() - (WEEKS - 1) * 7); // last column = this week
    const max = Math.max(1, ...[...byDay.values()].map((v) => v.w));
    const cols = [];
    for (let w = 0; w < WEEKS; w++) {
      const col = h('div', { class: 'hm-col' });
      for (let i = 0; i < 7; i++) {
        const d = new Date(start); d.setDate(start.getDate() + w * 7 + i);
        const v = byDay.get(key(d));
        const lvl = d > today ? -1 : !v ? 0 : Math.min(4, 1 + Math.floor((v.w / max) * 3.999));
        col.append(h('i', { class: `l${lvl}`, title: d > today ? '' : `${d.toLocaleDateString(undefined, { dateStyle: 'medium' })}: ${v ? `${v.w.toLocaleString()} words` : 'no dictation'}` }));
      }
      cols.push(col);
    }
    return h('div', { class: 'heatmap' }, cols);
  }

  function gauge(wpm) {
    // Half-circle gauge, 0–200 wpm.
    const f = Math.max(0, Math.min(1, wpm / 200)), r = 52, c = Math.PI * r;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 128 72'); svg.setAttribute('class', 'gauge');
    const arc = (cls, len) => {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', `M 12 66 A ${r} ${r} 0 0 1 116 66`); p.setAttribute('class', cls);
      if (len != null) p.setAttribute('stroke-dasharray', `${len} ${c}`);
      return p;
    };
    svg.append(arc('track'), arc('val', f * c));
    return svg;
  }

  TABS.insights = async () => {
    const { days, apps, fixes, stats } = await rf.call('history:insights');
    const byDay = new Map(days.map((d) => [d.d, d]));
    const wpm = stats.seconds > 0 ? Math.round((stats.words / stats.seconds) * 60) : 0;
    const appMax = Math.max(1, ...apps.map((a) => a.w));
    const saved = Math.max(0, Math.round(stats.words / TYPING_WPM - stats.seconds / 60));

    return [
      ...header('Insights', 'How you use RoyFlow. Worked out from your history on this Mac.'),
      h('div', { class: 'insights' },
        h('div', { class: 'card big' },
          gauge(wpm),
          h('b', {}, wpm || '—'), h('span', {}, 'words per minute'),
          h('small', {}, wpm ? `About ${Math.max(1, Math.round((wpm / TYPING_WPM) * 10) / 10)}× faster than typing` : 'Dictate a few times to see your speed')),
        h('div', { class: 'card tiles' },
          h('div', {}, h('b', {}, stats.words.toLocaleString()), h('span', {}, 'words dictated')),
          h('div', {}, h('b', {}, `${streak(byDay)}`), h('span', {}, 'day streak')),
          h('div', {}, h('b', {}, fixes.toLocaleString()), h('span', {}, 'AI fixes made')),
          h('div', {}, h('b', {}, saved >= 60 ? `${Math.round(saved / 6) / 10} h` : `${saved} min`), h('span', {}, 'time saved')))),

      h('h2', {}, 'Activity'),
      h('div', { class: 'card', style: 'padding:14px 16px' }, heatmap(byDay),
        h('div', { class: 'hm-legend' }, 'Less', ...[0, 1, 2, 3, 4].map((l) => h('i', { class: `l${l}` })), 'More')),

      h('h2', {}, 'Where you dictate · last 30 days'),
      h('div', { class: 'card' },
        apps.length
          ? apps.map((a) => h('div', { class: 'bar-row' },
            h('span', { class: 'name' }, a.name),
            h('span', { class: 'bar' }, h('i', { style: `width:${Math.max(2, (a.w / appMax) * 100)}%` })),
            h('span', { class: 'n' }, a.w.toLocaleString())))
          : h('div', { class: 'empty' }, 'Nothing yet.')),
    ];
  };
})();

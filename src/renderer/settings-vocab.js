'use strict';
(() => {
  const rf = window.royflow;
  const { TABS, h, header, render } = window.rfSettings;

  TABS.vocab = async () => {
    const { words, snippets } = await rf.call('vocab:list');

    const wordInput = h('input', { type: 'text', placeholder: 'Add a name, brand or term (e.g. RoyFlow)' });
    const addWord = async () => { if (wordInput.value.trim()) { await rf.call('vocab:add-word', wordInput.value); render(); } };
    wordInput.addEventListener('keydown', (e) => e.key === 'Enter' && addWord());

    const trig = h('input', { type: 'text', placeholder: 'When I say… (e.g. my calendar link)' });
    const exp = h('textarea', { placeholder: 'Type this instead…' });
    const saveSnippet = async () => {
      if (!trig.value.trim() || !exp.value) return;
      await rf.call('vocab:save-snippet', trig.value, exp.value);
      render();
    };

    return [
      ...header('Dictionary & Snippets', 'Teach RoyFlow your words, and give long text a short spoken shortcut.'),

      h('h2', {}, `Dictionary · ${words.length}`),
      h('div', { class: 'toolbar' }, wordInput, h('button', { class: 'primary', onclick: addWord }, 'Add')),
      h('div', { class: 'card' },
        words.length
          ? h('div', { class: 'chips' }, words.map((w) => h('span', { class: 'chip', title: 'Click to remove',
            onclick: async () => { await rf.call('vocab:delete-word', w.id); render(); } }, w.word, '  ×')))
          : h('div', { class: 'empty' }, 'No words yet. Add names and jargon Whisper gets wrong.')),
      h('p', { class: 'note' }, 'Words are given to the speech model as hints, and fixed afterwards: “roy flow” becomes “RoyFlow”.'),

      h('h2', {}, `Snippets · ${snippets.length}`),
      h('div', { class: 'card' },
        h('div', { class: 'row' }, h('div', { class: 't', style: 'flex:1' }, trig, h('div', { style: 'height:8px' }), exp),
          h('button', { class: 'primary', onclick: saveSnippet }, 'Save'))),
      h('div', { class: 'card', style: 'margin-top:10px' },
        snippets.length
          ? snippets.map((s) => h('div', { class: 'item' },
            h('div', {}, h('b', {}, `“${s.trigger}”`), h('div', { class: 'meta', style: 'white-space:pre-wrap' }, s.expansion)),
            h('div', { class: 'actions' },
              h('button', { onclick: () => { trig.value = s.trigger; exp.value = s.expansion; trig.focus(); } }, 'Edit'),
              h('button', { class: 'danger', onclick: async () => { await rf.call('vocab:delete-snippet', s.id); render(); } }, 'Delete'))))
          : h('div', { class: 'empty' }, 'No snippets yet. Say the trigger phrase and RoyFlow types the full text.')),
    ];
  };
})();

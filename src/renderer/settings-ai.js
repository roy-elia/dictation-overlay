'use strict';
(() => {
  const rf = window.royflow;
  const { TABS, h, header, row, toggle, select, status, set, render } = window.rfSettings;
  let testResult = null;

  TABS.ai = async () => {
    const S = window.rfSettings.S;
    const st = await rf.call('ai:status');
    const transforms = (S.transforms || []).map((t) => ({ ...t }));

    const key = h('input', { type: 'password', placeholder: st.savedKey ? '•••••••• saved in Keychain' : 'sk-ant-…', autocomplete: 'off' });
    const saveKey = async () => {
      try { await rf.call('ai:save-key', key.value); testResult = null; render(); }
      catch (e) { testResult = { ok: false, error: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }; render(); }
    };
    const test = async () => {
      testResult = { pending: true }; render();
      try { testResult = await rf.call('ai:test'); }
      catch (e) { testResult = { ok: false, error: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }; }
      render();
    };

    const custom = h('textarea', { placeholder: 'e.g. Use British spelling. Never use em dashes. Sign emails “— Roy”.' });
    custom.value = S.aiCustomInstructions || '';
    custom.addEventListener('change', () => set('aiCustomInstructions', custom.value));

    const result = testResult && (testResult.pending
      ? h('p', { class: 'note' }, 'Testing…')
      : testResult.ok
        ? h('p', { class: 'note' }, `✓ Works (${testResult.ms} ms): “${testResult.sample}”`)
        : h('p', { class: 'note', style: 'color:var(--bad)' }, `✗ ${testResult.error}`));

    return [
      ...header('AI Polish', 'Clean up dictation, rewrite selected text, and edit by voice, using Claude with your own API key.'),

      h('h2', {}, 'Claude API key'),
      h('div', { class: 'card' },
        row('Status', st.savedKey ? 'Stored encrypted in your macOS Keychain.' : st.envKey ? 'Using ANTHROPIC_API_KEY from the environment.' : 'Get a key at console.anthropic.com.',
          status(st.configured ? 'ok' : 'warn', st.configured ? 'Connected' : 'Not set up')),
        h('div', { class: 'row' }, key,
          h('div', { style: 'display:flex;gap:6px' },
            h('button', { class: 'primary', onclick: saveKey }, 'Save'),
            st.savedKey ? h('button', { class: 'danger', onclick: async () => { await rf.call('ai:clear-key'); render(); } }, 'Remove') : null,
            h('button', { onclick: test, disabled: !st.configured }, 'Test')))),
      result,
      h('p', { class: 'note' }, 'Text you polish or command is sent to Anthropic’s API. Plain dictation never leaves your Mac.'),

      h('h2', {}, 'Polish'),
      h('div', { class: 'card' },
        row('Polish every dictation', 'Adds about a second before pasting.', toggle(S.aiAutoPolish, (v) => set('aiAutoPolish', v), !st.configured)),
        row('Style', null, select([
          ['cleanup', 'Clean up: fix punctuation, remove ums'], ['polished', 'Polished prose'], ['formal', 'Formal'],
          ['casual', 'Casual'], ['concise', 'Concise'], ['custom', 'Custom (instructions below)'],
        ], S.aiStyle, (v) => set('aiStyle', v))),
        h('div', { class: 'row' }, h('div', { class: 't', style: 'flex:1' }, 'Extra instructions', h('small', {}, 'Applied to every polish.'), h('div', { style: 'height:6px' }), custom))),

      h('h2', {}, 'Rewrite shortcuts'),
      h('div', { class: 'card' },
        row('⌥1–9 shortcuts', 'Select text anywhere and press ⌥ plus a number to rewrite it. Turning this on takes over those keys’ special characters.',
          toggle(S.transformShortcuts, (v) => set('transformShortcuts', v), !st.configured)),
        ...transforms.map((t, i) => {
          const name = h('input', { type: 'text', value: t.name || '', placeholder: 'Name', style: 'width:150px' });
          const prompt = h('input', { type: 'text', value: t.prompt || '', placeholder: 'What to do with the text…', style: 'flex:1;min-width:0' });
          const save = () => { transforms[i] = { ...transforms[i], name: name.value.trim(), prompt: prompt.value.trim() }; set('transforms', transforms); };
          name.addEventListener('change', save); prompt.addEventListener('change', save);
          const auto = h('label', { class: 'chk', title: 'Also run this on every dictation, after formatting' },
            Object.assign(h('input', { type: 'checkbox' }), { checked: !!t.autoApply, onchange: async (e) => {
              transforms.forEach((x, j) => { x.autoApply = j === i ? e.target.checked : false; }); // at most one
              await set('transforms', transforms); render();
            } }), ' After dictation');
          return h('div', { class: 'row' },
            h('span', { class: 'keys' }, h('kbd', {}, '⌥'), ' + ', h('kbd', {}, String(i + 1))),
            name, prompt, auto,
            h('button', { class: 'danger', title: 'Remove', onclick: async () => { transforms.splice(i, 1); await set('transforms', transforms); render(); } }, '×'));
        }),
        transforms.length < 9 ? h('div', { class: 'row' }, h('div', { class: 't' }, h('small', {}, 'Up to 9 shortcuts.')),
          h('button', { onclick: async () => { transforms.push({ name: 'New shortcut', prompt: '', autoApply: false }); await set('transforms', transforms); render(); } }, 'Add shortcut')) : null),

      h('h2', {}, 'Voice commands'),
      h('div', { class: 'card' },
        row('Command mode', 'Select text, hold ⌃ then fn, and say what to do (“make this friendlier”, “translate to French”, “turn into bullet points”). With nothing selected, it writes new text.',
          h('span', { class: 'keys' }, h('kbd', {}, '⌃'), ' + ', h('kbd', {}, 'fn'))),
        row('Polish selection', 'From the menu bar or the pill’s right-click menu.', h('span', { class: 'keys' }, 'Menu'))),

      h('h2', {}, 'Model'),
      h('div', { class: 'card' },
        row('Model', null, select(st.models, S.aiModel, (v) => set('aiModel', v))),
        row('Effort', 'Higher is more careful but slower.', select([['low', 'Low (fastest)'], ['medium', 'Medium'], ['high', 'High']], S.aiEffort, (v) => set('aiEffort', v)))),
    ];
  };
})();

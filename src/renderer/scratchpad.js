'use strict';
const rf = window.royflow;
const $ = (id) => document.getElementById(id);
let notes = [], current = null, saveTimer = null, term = '';

const words = (t) => (t.match(/\S+/g) || []).length;
const when = (ms) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

async function applyTheme() {
  const { settings } = await rf.call('settings:get');
  const t = settings.theme || 'system';
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function list() {
  const box = $('notes');
  box.replaceChildren(...notes.filter((n) => !term || `${n.title} ${n.body}`.toLowerCase().includes(term)).map((n) => {
    const d = document.createElement('div');
    d.className = `n ${current && n.id === current.id ? 'on' : ''}`;
    const b = document.createElement('b'); b.textContent = n.title || n.body.split('\n')[0] || 'Untitled';
    const s = document.createElement('small'); s.textContent = when(n.updated_at);
    d.append(b, s);
    d.onclick = () => open(n.id);
    return d;
  }));
}

function show() {
  $('title').value = current?.title || '';
  $('body').value = current?.body || '';
  $('meta').textContent = current ? `${words(current.body)} words · saved ${when(current.updated_at)}` : '';
  list();
}

async function refresh(keepId) {
  notes = await rf.call('app:notes-list');
  current = notes.find((n) => n.id === keepId) || notes[0] || null;
  if (!current) current = await rf.call('app:notes-save', { title: '', body: '' }).then(() => rf.call('app:notes-list')).then((l) => { notes = l; return l[0]; });
  show();
}
async function open(id) { await flush(); current = notes.find((n) => n.id === id); show(); $('body').focus(); }

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 400);
}
async function flush() {
  clearTimeout(saveTimer);
  if (!current) return;
  const title = $('title').value, body = $('body').value;
  if (title === current.title && body === current.body) return;
  const saved = await rf.call('app:notes-save', { id: current.id, title, body });
  Object.assign(current, saved);
  notes = [current, ...notes.filter((n) => n.id !== current.id)];
  $('meta').textContent = `${words(body)} words · saved ${when(current.updated_at)}`;
  list();
}

$('title').addEventListener('input', scheduleSave);
$('body').addEventListener('input', scheduleSave);
$('search').addEventListener('input', (e) => { term = e.target.value.toLowerCase(); list(); });
$('new').onclick = async () => { await flush(); const n = await rf.call('app:notes-save', { title: '', body: '' }); await refresh(n.id); $('body').focus(); };
$('copy').onclick = () => rf.call('history:copy', $('body').value);
$('del').onclick = async () => { if (current && confirm('Delete this note?')) { await rf.call('app:notes-delete', current.id); await refresh(); } };
$('polish').onclick = async () => {
  const btn = $('polish'); const before = $('body').value;
  if (!before.trim()) return;
  btn.disabled = true; btn.textContent = 'Polishing…';
  try { $('body').value = await rf.call('app:notes-polish', before); await flush(); }
  catch (e) { alert(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  btn.disabled = false; btn.textContent = 'Polish with AI';
};
window.addEventListener('beforeunload', flush);
rf.on('ev:settings', (c) => { if (c.key === 'theme') applyTheme(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
applyTheme();
refresh().then(() => $('body').focus());

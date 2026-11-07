'use strict';
const rf = window.royflow;
const $ = (id) => document.getElementById(id);

// Word-level LCS diff: original -> polished.
function render(a, b) {
  const A = a.split(/\s+/).filter(Boolean), B = b.split(/\s+/).filter(Boolean);
  const out = $('body');
  out.replaceChildren();
  if (A.length * B.length > 250000) { out.textContent = b; return; }
  const dp = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  // Collect ops, then emit runs (deletions before insertions) separated by spaces.
  const ops = [];
  let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { ops.push(['=', A[i]]); i++; j++; }
    else if (j < B.length && (i >= A.length || dp[i][j + 1] >= dp[i + 1][j])) { ops.push(['ins', B[j]]); j++; }
    else { ops.push(['del', A[i]]); i++; }
  }
  const parts = [];
  for (let k = 0; k < ops.length;) {
    if (ops[k][0] === '=') { parts.push(document.createTextNode(ops[k][1])); k++; continue; }
    const del = [], ins = [];
    while (k < ops.length && ops[k][0] !== '=') (ops[k][0] === 'del' ? del : ins).push(ops[k++][1]);
    for (const [tag, w] of [['del', del], ['ins', ins]]) if (w.length) {
      const e = document.createElement(tag); e.textContent = w.join(' '); parts.push(e);
    }
  }
  parts.forEach((p, n) => { if (n) out.append(' '); out.append(p); });
}

async function load() {
  const d = await rf.call('pill:diff-data');
  if (!d) return;
  $('app').textContent = d.app ? `in ${d.app}` : '';
  render(d.before, d.after);
}
$('close').onclick = () => rf.call('pill:diff-action', 'close');
$('copy').onclick = async () => { await rf.call('pill:diff-action', 'copy'); $('hint').textContent = 'Original copied'; };
$('undo').onclick = async () => { await rf.call('pill:diff-action', 'undo'); $('hint').textContent = 'Undone'; };
rf.on('ev:diff-refresh', load);
load();

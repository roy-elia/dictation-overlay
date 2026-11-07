'use strict';
// Output formats, applied after vocabulary. Per-app rules pick one by the
// bundle id of the app being typed into; otherwise the default applies.
//   formatted  Whisper's punctuation and casing as-is
//   casual     no final period, lowercase first word (chat style)
//   lowercase  everything lowercase, no final period
//   raw        no punctuation at all
//   polish     rewrite with Claude (needs an API key; falls back to formatted)
const FORMATS = [
  ['formatted', 'Formatted'],
  ['casual', 'Casual'],
  ['lowercase', 'lowercase'],
  ['raw', 'Raw (no punctuation)'],
  ['polish', 'AI polish'],
];

function lowerFirst(t) {
  // keep "I", acronyms (NASA), and names from the dictionary (passed in)
  return t.replace(/^(\s*)(\S+)/, (m, sp, w) => (w === 'I' || /^[A-Z0-9]{2,}/.test(w) ? m : sp + w[0].toLowerCase() + w.slice(1)));
}

function applyFormat(text, format) {
  switch (format) {
    case 'casual': return lowerFirst(text.replace(/\.\s*$/, ''));
    case 'lowercase': return text.toLowerCase().replace(/\.\s*$/, '');
    case 'raw': return text.replace(/[.,!?;:…"“”()]+/g, '').replace(/\s{2,}/g, ' ').trim();
    default: return text;
  }
}

/** Pick the format for an app: per-app rule, else the default. */
function formatFor(config, app) {
  const rules = config.setting('appFormats') || [];
  const rule = app && rules.find((r) => r.bundleId === app.bundleId);
  if (rule) return rule.format;
  const def = config.setting('defaultFormat') || 'formatted';
  return def === 'formatted' && config.setting('aiAutoPolish') ? 'polish' : def;
}

module.exports = { FORMATS, applyFormat, formatFor };

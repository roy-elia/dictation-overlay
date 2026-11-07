'use strict';
// Personal vocabulary applied to every dictation:
//   - dictionary words bias Whisper (initial prompt) and fix casing/spacing
//     afterwards ("roy flow" -> "RoyFlow")
//   - snippets expand spoken trigger phrases into saved text
//   - "press enter" at the very end is stripped and turned into a Return key
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "RoyFlow" -> /\bRoy[\s-]?Flow\b/i ; "GPT-4o" -> /\bGPT[\s-]?4o\b/i
function wordPattern(word) {
  const parts = word.split(/[\s-]+|(?<=[a-z])(?=[A-Z])|(?<=[A-Za-z])(?=\d)/).filter(Boolean);
  return new RegExp(`(?<![\\w])${parts.map(escape).join('[\\s-]?')}(?![\\w])`, 'gi');
}

const PRESS_ENTER = /[\s,.;:!?-]*\bpress (?:enter|return)[.!]?\s*$/i;

function createVocab({ store, config }) {
  let cache = null;
  const load = () => {
    if (!cache) {
      const words = store.words().map((w) => w.word);
      const snippets = store.snippets();
      cache = {
        words,
        wordRes: words.map((w) => [wordPattern(w), w]),
        snippetRes: snippets
          .sort((a, b) => b.trigger.length - a.trigger.length) // longest trigger first
          .map((s) => [new RegExp(`(?<![\\w])${escape(s.trigger).replace(/\s+/g, '[\\s,]+')}(?![\\w])[.!?]?`, 'gi'), s.expansion, s.trigger]),
      };
    }
    return cache;
  };

  return {
    invalidate() { cache = null; },

    /** Whisper initial prompt: nudges spelling of names/jargon. Kept short. */
    prompt() {
      const { words } = load();
      if (!words.length) return '';
      let out = 'Glossary: ';
      for (const w of words) { if (out.length + w.length > 600) break; out += `${w}, `; }
      return out.replace(/, $/, '.');
    },

    /** @returns {{text: string, pressEnter: boolean}} */
    apply(raw) {
      let text = (raw || '').trim();
      let pressEnter = false;
      if (config.setting('pressEnterCommand') && PRESS_ENTER.test(text)) {
        text = text.replace(PRESS_ENTER, '');
        pressEnter = true;
      }
      const { wordRes, snippetRes } = load();
      for (const [re, w] of wordRes) text = text.replace(re, w);

      // A dictation that is exactly a trigger becomes exactly the snippet.
      const bare = text.replace(/[.!?,\s]+$/, '').toLowerCase();
      const whole = snippetRes.find(([, , trig]) => trig.toLowerCase() === bare);
      if (whole) text = whole[1];
      else for (const [re, exp] of snippetRes) text = text.replace(re, exp);

      return { text: text.trim(), pressEnter };
    },
  };
}

module.exports = { createVocab, wordPattern, PRESS_ENTER };

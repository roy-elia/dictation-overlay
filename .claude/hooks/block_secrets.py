#!/usr/bin/env python3
"""PreToolUse guard (standard section 9.3): block writes whose content looks like a secret.

Source: roy-elia/ai-standards hooks/block_secrets.py (standard v2026-11-23).
Exit 2 blocks the action and stderr becomes the reason. Any error in the guard
itself exits 0 with "guard NOT RUN", so a broken guard never stops work.
Standard library only.
"""
import json
import re
import sys

PATTERNS = [
    (r"AKIA[0-9A-Z]{16}", "an AWS access key"),
    (r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----", "a private key"),
    (r"\bgh[pousr]_[A-Za-z0-9]{36,}\b", "a GitHub token"),
    (r"\bsk-ant-[A-Za-z0-9_-]{20,}", "an Anthropic API key"),
    (r"\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b", "an OpenAI-style API key"),
    (r"\bxox[abpr]-[A-Za-z0-9-]{10,}", "a Slack token"),
    (r"\bAIza[0-9A-Za-z_-]{35}\b", "a Google API key"),
    (r"(?i)\b(api[_-]?key|secret|token|password)\s*[:=]\s*['\"][A-Za-z0-9_\-+/=.]{20,}['\"]", "a hard-coded credential"),
]
ALLOW_PATH_PARTS = ("/tests/", "/test/", "/fixtures/", ".example", ".sample")


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)


def main():
    try:
        event = json.load(sys.stdin)
        tool_input = event.get("tool_input", {}) or {}
        path = str(tool_input.get("file_path", "")).replace("\\", "/")
        text = "\n".join(s for k, v in tool_input.items() if k != "file_path" for s in strings(v))
    except Exception:
        print("guard NOT RUN: could not read the hook input", file=sys.stderr)
        return 0

    if path.endswith("/.env") or path == ".env":
        return 0  # .env is ignored by Git; that is where keys belong.
    if any(part in path for part in ALLOW_PATH_PARTS):
        return 0

    for pattern, label in PATTERNS:
        if re.search(pattern, text):
            print(
                f"Blocked: the content looks like {label}. Put it in .env (ignored by Git) "
                "and read it from the environment instead.",
                file=sys.stderr,
            )
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())

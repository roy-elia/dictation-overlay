#!/usr/bin/env bash
# AI Repository Design Standard, section 18.1 health check.
# Source: roy-elia/ai-standards checks/health_check.sh (standard v2026-11-23).
# Run from anywhere inside the repository. Exit 1 on any FAIL.
set -u
root="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "guard NOT RUN: not a git repo"; exit 0; }
cd "$root" || exit 0

routers=""
for f in AGENTS.md CLAUDE.md; do [ -f "$f" ] && routers="$routers $f"; done

run_checks() {
  [ -n "$routers" ] || echo "FAIL no root instruction file (AGENTS.md or CLAUDE.md)"

  # 1. Every path named in the root files exists (placeholders and "first use" lines skipped).
  for f in $routers; do
    grep -v -i 'first use' "$f" \
      | grep -oE '`[A-Za-z0-9_.][A-Za-z0-9_./-]*/[A-Za-z0-9_./-]*`|\]\([A-Za-z0-9_.][A-Za-z0-9_./-]*\)' \
      | sed -E 's/^`//; s/`$//; s/^\]\(//; s/\)$//' | sort -u | while read -r p; do
        case "$p" in (*'<'*|*'{'*|*'*'*|http*|/*|~*|\$*) continue;; esac
        [ -e "$p" ] && continue
        first="${p%%/*}"
        # Not a repo path (branch name, package id) or a local-only path (ignored): skip.
        [ -e "$first" ] || continue
        git check-ignore -q "$p" 2>/dev/null && continue
        echo "FAIL missing path in $f: $p"
      done
  done

  # 2-3. Skill name equals folder name, and every skill folder has a catalog row.
  for s in .claude/skills/*/SKILL.md; do
    [ -e "$s" ] || continue
    dir="$(basename "$(dirname "$s")")"
    name="$(sed -n 's/^name:[[:space:]]*//p' "$s" | head -1 | tr -d "\"'")"
    [ "$name" = "$dir" ] || echo "FAIL skill name '$name' != folder '$dir'"
    [ -n "$routers" ] && ! grep -q -- "$dir" $routers && echo "FAIL skill '$dir' has no catalog row"
  done

  # 5. Front matter on tracked docs.
  git ls-files 'docs/*.md' 'docs/**/*.md' | while read -r f; do
    head -1 "$f" | grep -q '^---$' || { echo "FAIL no front matter: $f"; continue; }
    for k in owner status last_updated source_of_truth; do
      sed -n '2,/^---$/p' "$f" | grep -q "^$k:" || echo "FAIL front matter missing '$k': $f"
    done
  done

  # 6. Hook commands point to scripts that exist.
  if [ -f .claude/settings.json ]; then
    grep -oE '(\$\{?CLAUDE_PROJECT_DIR\}?|\.)/\.claude/[A-Za-z0-9_./-]+' .claude/settings.json | sort -u | while read -r h; do
      rel="${h#*CLAUDE_PROJECT_DIR}"; rel="${rel#\}}"; rel="${rel#/}"; rel="${rel#./}"
      [ -e "$rel" ] || echo "FAIL hook script missing: $rel"
    done
  fi

  # 7. .env ignored and not tracked.
  git check-ignore -q .env || echo "FAIL .env is not ignored"
  git ls-files | grep -qE '(^|/)\.env$' && echo "FAIL a .env file is tracked"
  # No tracked file matches a high-confidence secret pattern (file names only, never values).
  # Known fake fixtures can be listed, one path per line, in .github/ai-secret-allowlist.
  allow=()
  [ -f .github/ai-secret-allowlist ] && while read -r a; do case "$a" in (''|'#'*) ;; (*) allow+=(":!$a");; esac; done < .github/ai-secret-allowlist
  git grep -lIE 'AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36,}|sk-ant-[A-Za-z0-9_-]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|authtoken:[[:space:]]*[A-Za-z0-9_]{20,}' \
    -- . ':!*.example' ':!*.sample' ':(exclude,icase,glob)**/test/**' ':(exclude,icase,glob)**/tests/**' ':(exclude,icase,glob)**/fixtures/**' ${allow[@]+"${allow[@]}"} \
       ':!.github/scripts/ai-health-check.sh' ':!.claude/hooks/block_secrets.py' 2>/dev/null \
    | while read -r s; do echo "FAIL possible secret in tracked file: $s (rotate it, then remove it)"; done

  # 8. No nested git repositories (worktrees under .claude/worktrees are fine).
  find . -mindepth 2 -maxdepth 4 -name .git -type d -not -path './node_modules/*' -not -path './.claude/worktrees/*' 2>/dev/null \
    | while read -r g; do echo "FAIL nested git repository: $(dirname "$g")"; done

  # 9. Each sources/ folder has a summary beside it.
  git ls-files | grep -oE '^(.*/)?sources/' | sort -u | while read -r s; do
    parent="$(dirname "$s")"
    ls "$parent"/*summary*.md >/dev/null 2>&1 || echo "FAIL $s has no *-summary.md beside it"
  done
}

out="$(run_checks)"
[ -n "$out" ] && echo "$out"
if echo "$out" | grep -q '^FAIL'; then echo "health check: FAIL"; exit 1; fi
echo "health check: PASS"

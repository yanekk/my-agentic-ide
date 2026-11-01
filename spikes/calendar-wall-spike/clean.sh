#!/usr/bin/env bash
# Removes every probe run.sh made: agents named "wall-probe …", their worktrees and
# branches, in each repo probed, and the scratch folder. Discards the probes' commits.
# Touches nothing without "wall-probe" in its name, apart from the scratch folder.
set -u

SPIKE="$(cd "$(dirname "$0")" && pwd)"
MAIN="$(cd "$(git -C "$SPIKE" rev-parse --git-common-dir)/.." && pwd)"
HERE="$(git -C "$SPIKE" rev-parse --show-toplevel)"
FROG="$HOME/src/superfrog-re"

for id in $(claude agents --json --all 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const a of JSON.parse(s))if(/^wall-probe /.test(a.name??""))console.log(a.id)})'); do
  claude stop "$id" >/dev/null 2>&1
  # rm names the exact flag it wants when a worktree holds commits or edits; it can
  # want more than one in turn. Probes' sessions are dead by now.
  args=(); rc=1
  for _ in 1 2 3 4; do
    out="$(claude rm "$id" ${args[@]+"${args[@]}"} 2>&1)"; rc=$?
    [ $rc -eq 0 ] && break
    flag="$(printf '%s' "$out" | grep -oE -- '--(discard-unpushed|force-remove-worktree) [^ ]+' | head -1)"
    [ -z "$flag" ] && break
    args+=(${flag%% *} "${flag#* }")
  done
  [ $rc -eq 0 ] || printf '%s\n' "$out"
  echo "agent $id rm rc=$rc"
done

for repo in "$MAIN" "$HERE" "$FROG"; do
  git -C "$repo" worktree list --porcelain | sed -n 's/^worktree //p' | grep '/wall-probe-' | while read -r w; do
    git -C "$repo" worktree remove --force --force "$w" && echo "worktree removed $w"
  done
  git -C "$repo" worktree prune
  git -C "$repo" for-each-ref --format='%(refname:short)' refs/heads | grep 'wall-probe' | while read -r b; do
    git -C "$repo" branch -D "$b" >/dev/null && echo "branch removed $b"
  done
done

# rm keeps a session whose worktree held uncommitted files; with the worktree gone it goes.
for id in $(claude agents --json --all 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const a of JSON.parse(s))if(/^wall-probe /.test(a.name??""))console.log(a.id)})'); do
  claude rm "$id" >/dev/null 2>&1; echo "agent $id second pass rc=$?"
done

rm -rf "$HOME/.wall-spike-scratch"
for repo in "$MAIN" "$FROG"; do
  echo "--- $repo"; git -C "$repo" worktree list | grep wall-probe || echo "no probe worktrees"
  git -C "$repo" for-each-ref refs/heads | grep wall-probe || echo "no probe branches"
done
claude agents --json --all 2>/dev/null | grep -c '"wall-probe ' | sed 's/^/probe agents left: /'

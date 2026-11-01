# Finishing rules (agentic-ide)

The target branch is the branch the run was cut from. pir names it to the finisher; it is not set here.

1. In the person's main checkout, merge the build's branch into the target branch:
   `git -C <main checkout> merge pir/{slug}`, with the checkout on the target branch.
2. Confirm the target branch now contains the branch tip:
   `git -C <main checkout> merge-base --is-ancestor pir/{slug} <target>` succeeds.
3. Push the target branch: `git -C <main checkout> push origin <target>`.

Nothing else: no pull request, no release. **Never run `bin/install.sh`** — it relinks
`~/.claude/cockpit/bin` and points `~/.wezterm.lua` at this checkout, so it changes the cockpit
running on this machine. The person rebuilds WezTerm when they want that.

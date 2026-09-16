# T00 — Capture the real `rate_limits` stdin shape

**Phase:** 0 · **Runs:** you · **Depends on:** — · **Weight:** light · **Throwaway**

## Goal

Prove, on this machine and this Claude Code version, that a statusline command is handed a
`rate_limits` object on stdin during a personal-subscription session, and capture one real
sample. Everything downstream parses that shape; T02 and its tests are written against the
captured JSON, not against an assumed shape. This is throwaway: once the sample is in FINDINGS,
the probe script is deleted.

## Design sections this implements

DESIGN §2.1 (the source), §2.5 (presence = subscription), §5.1 (only a person can establish this).

## Files

- A throwaway probe script (e.g. `/tmp/usage-probe.mjs`) that reads stdin and appends it to a
  known file. Not under `bin/`. Deleted at the end.
- No product code in this task.

## Interface

The probe is a statusline command Claude Code will call. It reads all of stdin and writes it
verbatim to a capture file, then prints nothing:

```
#!/usr/bin/env node
// reads stdin JSON, appends it to ~/usage-capture.jsonl, prints ""
```

Temporarily point `~/.claude/settings.json`'s `statusLine` at it (by hand, restored after), or
run `claude` with a settings override. The capture then holds the real object; the field of
interest is `rate_limits`.

## Tests

No automated tests — this task exists precisely because the shape cannot be asserted without a
live subscription (DESIGN §5.1).

## Done when

- [ ] A real stdin sample from a personal session is captured, showing whether `rate_limits` is
      present and its exact nesting and field names.
- [ ] The sample (or its `rate_limits` sub-object, with any personal numbers left as-is or
      rounded) is recorded in FINDINGS.md, dated, as the reference T02 parses.
- [ ] The probe script and the temporary settings change are removed; `settings.json` is back
      to its original content.

## Needs a person

This is the whole task: only a live Pro/Max subscription populates `rate_limits`.

```
# 1. Save this as /tmp/usage-probe.mjs and chmod +x:
#    #!/usr/bin/env node
#    let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
#      require("fs").appendFileSync(process.env.HOME+"/usage-capture.jsonl", s+"\n"); process.stdout.write(""); });
# 2. Temporarily add to ~/.claude/settings.json (back it up first):
#    "statusLine": { "type": "command", "command": "/tmp/usage-probe.mjs" }
# 3. In a PERSONAL-subscription claude session, send any two messages.
# 4. Then:
cat ~/usage-capture.jsonl | tail -1 | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.stringify(JSON.parse(s).rate_limits,null,2)))'
```

Expect: a `rate_limits` object with `five_hour` and `seven_day`, each holding
`used_percentage` and `resets_at`.
Tell me: the exact JSON printed by step 4 (feel free to round the percentages), and whether it
appeared on the first message or only the second. Then restore `settings.json`.

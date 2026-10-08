# T04 — install-report

**Phase:** 2 · **Depends on:** T02 · **Weight:** light

## Goal

`bin/install.sh` says whether pir's API service is running, next to its existing optional `pir`
line. The footer is silent about the feed, so this is where a person learns why the bar went
stale during a pir run.

## Design sections this implements

DESIGN §2.7.

## Files

- `bin/install.sh` (after the `PIR_PATH` block's `fi`; that block itself is not edited)
- `spikes/usage-test/run.sh` (bash checks on the real lines of `install.sh`)

## Interface

Only when `PIR_PATH` is non-empty:

```
PIR_API="$(node "$REPO/bin/cockpit-usage-pir.mjs" --status 2>/dev/null)"
  running <origin>  →  ok   "$(printf '%-8s %s' pir-api "<origin>")"
  anything else     →  warn "$(printf '%-8s %s' pir-api "optional -- not running; the usage bar will not refresh during pir runs (pir service on)")"
```

`--status` exits 1 when the service is off; the installer runs under whatever `set` options it
already has, so the call must not end the script. Reason: the report is optional and must never
fail an install. It does not touch `MISSING` and never starts the service.

## Tests

Asserted on the real lines of `bin/install.sh`, as `spikes/pir-pane-test/run.sh` does for the
`pir` line: the installer has no dry run and a copy of its lines would drift.

- [ ] The `pir-api` block calls `cockpit-usage-pir.mjs --status`.
- [ ] It sits inside a `PIR_PATH` non-empty guard.
- [ ] It contains no `bad`, `die`, `exit` and no `MISSING`.
- [ ] It contains `ok` and `warn` branches, and the warn text names `pir service on`.
- [ ] Extracted and run with a stub `ok`/`warn` and `PIR_HOME` at a scratch home with no
      `api.json`: prints the warn line, exit status 0.
- [ ] The same with a stand-in service running: prints the ok line with its origin.

## Done when

- [ ] `bash spikes/usage-test/run.sh` and `bash spikes/pir-pane-test/run.sh` are green.
- [ ] `bash -n bin/install.sh` passes.
- [ ] `bin/install.sh` was not run on the real machine (DESIGN §5.3).

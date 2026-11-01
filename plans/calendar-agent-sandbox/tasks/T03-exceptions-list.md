# T03 — exceptions-list

**Phase:** 1 · **Depends on:** T01 · **Weight:** medium

## Goal

The per-project list and the only way to add to it: a command a person types, refused to agents.

## Design sections this implements

§2.7, §3.5.

## Files

`bin/cockpit-wall-store.mjs` (new), `bin/cockpit-agenda.mjs` (the verb, its dispatch, USAGE), `spikes/agenda-test/cli.test.mjs` or a new suite there, `spikes/calendar-jobs-test/wall-store.test.mjs` (new).

## Interface

```
agenda wall                                  all projects with exceptions
agenda wall <project>                        what that project has, plus the defaults
agenda wall <project> allow-site <host>      refused to agents
agenda wall <project> allow-ports            refused to agents
agenda wall <project> allow-write <path>     refused to agents; absolute after resolving
agenda wall <project> remove site|ports|write [value]   refused to agents
```

```js
// cockpit-wall-store.mjs
readWall()      // -> { projects, unreadable: bool }; never throws, never quarantines
writeWall(obj)  // 0600, temp-then-rename
```

Project names pass the jobs title pattern. `allow-site` prints a line saying an allowed site can also receive data. A refused value prints `validateException`'s reason. `refuseIfAgent` gets a `wall` reason: it changes what agents may do. Reading verbs are open, so the skill can show the list.

## Tests

- [ ] Each verb adds and removes; a repeat is idempotent; two sites kept in order.
- [ ] `CLAUDECODE` set: each changing verb refused, file untouched; reading works.
- [ ] Every forbidden value from T01 refused with no write.
- [ ] A bad project name refused; `__proto__` safe.
- [ ] File mode 0600; corrupt file reads as `unreadable` and is not moved or rewritten by a read.
- [ ] A write on a corrupt file refuses and says so, so a person does not lose rows silently.

## Done when

- [ ] `spikes/agenda-test/run.sh` and `spikes/calendar-jobs-test/run.sh` pass.
- [ ] `agenda` with no arguments' help lists the verb.

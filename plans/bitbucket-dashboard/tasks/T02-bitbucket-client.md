# T02 — The BitBucket HTTPS client

**Phase:** 1 · **Depends on:** T01 · **Weight:** heavy

## Goal

Talk to BitBucket Cloud: identify who the token belongs to, and list a repository's open pull
requests with everything a row needs in one call. Read-only. This is the task that turns the
provisional classify rules into something testable against real PRs, so it comes before T03 and
carries the one hand-check only the user can run.

## Design sections this implements

DESIGN §2.6 (Basic auth from `email:api-token`, "me" from `/2.0/user`), §2.9 (the one-call-per-repo
fetch and field expansion), §2.n (401/403 vs transient), §3.1–3.2 (shell side), §5.2 (the origin
and GET-only seatbelts).

## Files

- `bin/cockpit-bitbucket-client.mjs` — new.
- `spikes/bitbucket-test/client.test.mjs` — new; against a loopback stub.
- `spikes/bitbucket-test/run.sh` — add the origin-seam and GET-only greps.

## Interface

```
// All endpoints built from a base origin so a test can re-point them.
const ORIGIN = process.env.BITBUCKET_ORIGIN || "https://api.bitbucket.org";

// key is the raw `email:api-token`; split on the FIRST colon (a token may contain colons).
export async function getUser({ key, origin })
  -> { uuid, nickname, accountId }            // GET /2.0/user

export async function listOpenPRs({ key, workspace, repo, origin })
  -> { prs: RawPR[] }                         // follows `next` to completion
// GET /2.0/repositories/{workspace}/{repo}/pullrequests
//     ?state=OPEN&fields=%2Bvalues.participants,%2Bvalues.reviewers&pagelen=50

// Errors are classified, not thrown raw, so the daemon can tell "act on it" from "wait":
//   { errorKind: "auth" }        on 401/403
//   { errorKind: "transient" }   on any other HTTP status or a network failure
// getUser and listOpenPRs return { error: { kind } } rather than rejecting.
```

A `RawPR` is passed to the model untouched (T03 normalizes it); the client does not reshape,
only fetches and paginates. The client has **no** method that POSTs, PUTs or DELETEs — GET only
(DESIGN §5.2).

## Tests

- [ ] the Authorization header is `Basic base64(email:api-token)`, split on the first colon
- [ ] a token containing a colon is preserved
- [ ] `getUser` returns the uuid from a stubbed `/2.0/user`
- [ ] `listOpenPRs` sends `state=OPEN` and the participants+reviewers field expansion
- [ ] pagination follows `next` and concatenates pages; stops when `next` is absent
- [ ] a 401 and a 403 both return `errorKind: "auth"`
- [ ] a 500 and a dropped connection both return `errorKind: "transient"`
- [ ] no test names an origin other than the loopback stub (run.sh grep enforces it)
- [ ] the client source contains no mutating HTTP method (run.sh grep enforces it)

## Done when

- [ ] `getUser` and `listOpenPRs` work against the loopback stub with the tests above green
- [ ] error classification splits auth from transient
- [ ] the real-token hand-check below has been run with the user and its result is in FINDINGS

## Needs a person

The stub proves the shape; only the user's token proves it authenticates against their private
workspace. Run this once, read-only, when the task reaches it — and wait for the answer.

# `config` never prints the secret, so the hand-check reads the key file directly, the way the
# naming hook reads the Anthropic key.
```
BITBUCKET_KEY="$(cat ~/.claude/cockpit/bitbucket-key)" \
  node -e 'import("./bin/cockpit-bitbucket-client.mjs").then(async m => {
    const key = process.env.BITBUCKET_KEY;
    console.log(await m.getUser({ key }));
    console.log((await m.listOpenPRs({ key, workspace: "<your-ws>", repo: "<one-repo>" })).prs?.length, "open PRs");
  })'
```

Expect: your uuid/nickname printed, then a count of open PRs for one real repo. No writes.
Tell me: did it authenticate? Does the PR count look right, and do a couple of the PRs carry the
approvals and comment counts you expect? (This is also the moment for the classify brainstorm —
DESIGN §2.3.)

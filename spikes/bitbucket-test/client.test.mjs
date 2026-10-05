// The BitBucket HTTPS client, driven against a loopback stub -- it never reaches
// api.bitbucket.org (DESIGN 5.2). The stub records every request (method, path,
// headers) so the auth header and the query the client SENDS are assertable, and
// answers with whatever a case needs so the pagination and error paths are exercised
// without the real API. run.sh greps this file to prove every stub reference here
// names the loopback stub, and greps the client to prove it has no mutating verb.

import http from "node:http";
import { getUser, listOpenPRs, listPRComments, listPRDiffstat } from "../../bin/cockpit-bitbucket-client.mjs";
import { ok, eq, section, done } from "./harness.mjs";

// A loopback stub. `stub.respond(req, n)` decides each reply (n is the 1-based
// request number, for pagination); returning the string "drop" destroys the socket
// mid-response, which is how the dropped-connection case is produced. Defaults to a
// bare 200 so a case only sets what it cares about.
async function startStub() {
  const requests = [];
  const stub = {
    requests,
    respond: () => ({ status: 200, body: {} }),
  };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers });
      const r = stub.respond(req, requests.length);
      if (r === "drop") { res.destroy(); return; }
      res.writeHead(r.status ?? 200, { "Content-Type": "application/json" });
      res.end(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  stub.origin = `http://127.0.0.1:${server.address().port}`;
  stub.close = () => new Promise((resolve) => server.close(resolve));
  return stub;
}

const bearerToken = (auth) => String(auth ?? "").replace(/^Bearer /, "");

async function main() {
  section("the Authorization header is Bearer <token>, verbatim");
  {
    const stub = await startStub();
    stub.respond = () => ({ status: 200, body: { uuid: "{u-1}", nickname: "me", account_id: "a1" } });

    // A BitBucket access token (DESIGN 2.6, revised 2026-09-05): one opaque string,
    // sent as-is. Not base64'd, not an email:token pair -- the Basic scheme this
    // replaced 400'd the real key.
    const key = "ATCTT3xFfGN0-abc123TOKEN9876";
    await getUser({ key, origin: stub.origin });
    const auth = stub.requests[0].headers.authorization;
    ok("the scheme is Bearer", /^Bearer /.test(auth || ""), auth);
    eq("the token is the raw key, unencoded", bearerToken(auth), key);

    await stub.close();
  }

  section("the token is sent untouched, whatever bytes it holds");
  {
    const stub = await startStub();
    stub.respond = () => ({ status: 200, body: { uuid: "{u}" } });

    // A colon in the token is no longer special (there is nothing to split on any
    // more); it must survive verbatim like every other byte. Proven here so a future
    // "let me parse the key" change has a test to answer to.
    const key = "tok:with:colons-and.dashes_and+plus";
    await getUser({ key, origin: stub.origin });
    eq("the whole token round-trips into the header", bearerToken(stub.requests[0].headers.authorization), key);

    await stub.close();
  }

  section("getUser returns the uuid from /2.0/user");
  {
    const stub = await startStub();
    stub.respond = () => ({ status: 200, body: { uuid: "{abc-123}", nickname: "yanek", account_id: "acc-9" } });

    const r = await getUser({ key: "e:t", origin: stub.origin });
    eq("the path is /2.0/user", stub.requests[0].url, "/2.0/user");
    eq("uuid", r.uuid, "{abc-123}");
    eq("nickname", r.nickname, "yanek");
    eq("accountId comes from account_id", r.accountId, "acc-9");
    ok("no error on success", !r.error);

    await stub.close();
  }

  section("listOpenPRs sends state=OPEN and a whitelist naming every field the model reads");
  {
    const stub = await startStub();
    stub.respond = () => ({ status: 200, body: { values: [{ id: 1 }] } });

    await listOpenPRs({ key: "e:t", workspace: "acme", repo: "web", origin: stub.origin });
    const u = new URL(stub.requests[0].url, stub.origin);
    ok("the path names the workspace and repo", u.pathname === "/2.0/repositories/acme/web/pullrequests", u.pathname);
    eq("state is OPEN", u.searchParams.get("state"), "OPEN");
    const fields = (u.searchParams.get("fields") || "").split(",");
    ok("fields is a whitelist, not a + expansion", fields.length > 0 && fields.every((f) => !f.startsWith("+")), fields.join(","));
    for (const f of ["size", "next", "values.id", "values.title", "values.draft", "values.comment_count",
      "values.created_on", "values.updated_on", "values.author.uuid", "values.author.nickname",
      "values.participants.approved", "values.participants.user.uuid", "values.reviewers.uuid",
      "values.links.html.href", "values.source.branch.name", "values.destination.branch.name"]) {
      ok(`fields names ${f}`, fields.includes(f));
    }
    eq("pagelen is 50", u.searchParams.get("pagelen"), "50");

    await stub.close();
  }

  section("with `size`, pages 2..N are fetched by number, all of them, deduped by id");
  {
    const stub = await startStub();
    // size 230 in pages of 50 is 5 pages. Page 3
    // repeats an id from page 2 (a PR that shifted mid-fetch) -- it must appear once.
    stub.respond = (req) => {
      const page = Number(new URL(req.url, stub.origin).searchParams.get("page") || 1);
      const ids = page === 3 ? [200, 300] : [page * 100];
      return { status: 200, body: { size: 230, values: ids.map((id) => ({ id })), next: page < 5 ? `${stub.origin}/n` : undefined } };
    };
    const r = await listOpenPRs({ key: "e:t", workspace: "acme", repo: "web", origin: stub.origin });
    eq("one request per page, never the `next` url", stub.requests.length, 5);
    const asked = stub.requests.map((q) => new URL(q.url, stub.origin).searchParams.get("page")).slice(1).sort();
    eq("pages 2..5 asked for by number", asked, ["2", "3", "4", "5"]);
    ok("every later page keeps the whitelist", stub.requests.slice(1).every((q) => /values\.id/.test(decodeURIComponent(q.url))));
    eq("all PRs, page order, duplicate dropped", r.prs.map((p) => p.id), [100, 200, 300, 400, 500]);
    await stub.close();
  }

  section("a failing later page fails the whole repo");
  {
    const stub = await startStub();
    stub.respond = (req) => {
      const page = Number(new URL(req.url, stub.origin).searchParams.get("page") || 1);
      if (page === 4) return { status: 500, body: {} };
      return { status: 200, body: { size: 230, values: [{ id: page }], next: `${stub.origin}/n` } };
    };
    const r = await listOpenPRs({ key: "e:t", workspace: "acme", repo: "web", origin: stub.origin });
    eq("transient, no partial list", r, { error: { kind: "transient" } });
    await stub.close();
  }

  section("pagination follows `next` and concatenates; stops when it is absent");
  {
    const stub = await startStub();
    stub.respond = (req, n) => {
      if (n === 1) return { status: 200, body: { values: [{ id: 1 }, { id: 2 }], next: `${stub.origin}/pg2` } };
      if (n === 2) return { status: 200, body: { values: [{ id: 3 }], next: `${stub.origin}/pg3` } };
      return { status: 200, body: { values: [{ id: 4 }] } }; // no next -> stop
    };

    const r = await listOpenPRs({ key: "e:t", workspace: "acme", repo: "web", origin: stub.origin });
    eq("every page is concatenated in order", r.prs.map((p) => p.id), [1, 2, 3, 4]);
    eq("it stopped when `next` was absent", stub.requests.length, 3);
    ok("the auth header is re-sent on every page", stub.requests.every((q) => /^Bearer /.test(q.headers.authorization || "")));

    await stub.close();
  }

  section("listPRComments hits the PR's comments endpoint and paginates");
  {
    const stub = await startStub();
    stub.respond = (req, n) => {
      if (n === 1) return { status: 200, body: { values: [{ id: 10 }, { id: 11 }], next: `${stub.origin}/c2` } };
      return { status: 200, body: { values: [{ id: 12 }] } }; // no next -> stop
    };

    const r = await listPRComments({ key: "tok", workspace: "acme", repo: "web", prId: 7, origin: stub.origin });
    const u = new URL(stub.requests[0].url, stub.origin);
    eq("the path is the PR's comments collection", u.pathname, "/2.0/repositories/acme/web/pullrequests/7/comments");
    eq("every page is concatenated in order", r.comments.map((c) => c.id), [10, 11, 12]);
    eq("it stopped when `next` was absent", stub.requests.length, 2);
    ok("the bearer header is sent", /^Bearer tok$/.test(stub.requests[0].headers.authorization || ""));

    await stub.close();
  }

  section("listPRComments classifies auth and transient like the other calls");
  {
    for (const [status, kind] of [[401, "auth"], [403, "auth"], [500, "transient"]]) {
      const stub = await startStub();
      stub.respond = () => ({ status, body: { type: "error" } });
      const r = await listPRComments({ key: "tok", workspace: "w", repo: "r", prId: 1, origin: stub.origin });
      eq(`comments ${status} -> ${kind}`, r.error && r.error.kind, kind);
      await stub.close();
    }
    const stub = await startStub();
    stub.respond = () => "drop";
    const r = await listPRComments({ key: "tok", workspace: "w", repo: "r", prId: 1, origin: stub.origin });
    eq("a dropped socket -> transient", r.error && r.error.kind, "transient");
    await stub.close();
  }

  section("listPRDiffstat hits the PR's diffstat endpoint and paginates");
  {
    const stub = await startStub();
    stub.respond = (req, n) => {
      if (n === 1) return { status: 200, body: { values: [{ lines_added: 1 }, { lines_added: 2 }], next: `${stub.origin}/d2` } };
      return { status: 200, body: { values: [{ lines_added: 3 }] } }; // no next -> stop
    };

    const r = await listPRDiffstat({ key: "tok", workspace: "acme", repo: "web", prId: 7, origin: stub.origin });
    const u = new URL(stub.requests[0].url, stub.origin);
    eq("the path is the PR's diffstat collection", u.pathname, "/2.0/repositories/acme/web/pullrequests/7/diffstat");
    eq("every page is concatenated in order", r.diffstat.map((d) => d.lines_added), [1, 2, 3]);
    eq("it stopped when `next` was absent", stub.requests.length, 2);
    ok("the bearer header is re-sent on every page", stub.requests.every((q) => /^Bearer tok$/.test(q.headers.authorization || "")));

    await stub.close();
  }

  section("listPRDiffstat classifies auth and transient like the other calls");
  {
    for (const [status, kind] of [[401, "auth"], [403, "auth"], [500, "transient"]]) {
      const stub = await startStub();
      stub.respond = () => ({ status, body: { type: "error" } });
      const r = await listPRDiffstat({ key: "tok", workspace: "w", repo: "r", prId: 1, origin: stub.origin });
      eq(`diffstat ${status} -> ${kind}`, r.error && r.error.kind, kind);
      await stub.close();
    }
    // A dropped socket and an unparseable 200 are both transient, not a dead
    // credential -- the same reasoning as listPRComments.
    {
      const stub = await startStub();
      stub.respond = () => "drop";
      const d = await listPRDiffstat({ key: "tok", workspace: "w", repo: "r", prId: 1, origin: stub.origin });
      eq("a dropped socket -> transient", d.error && d.error.kind, "transient");
      await stub.close();
    }
    {
      const stub = await startStub();
      stub.respond = () => ({ status: 200, body: "{ not json" });
      const g = await listPRDiffstat({ key: "tok", workspace: "w", repo: "r", prId: 1, origin: stub.origin });
      eq("a garbage 200 -> transient", g.error && g.error.kind, "transient");
      await stub.close();
    }
  }

  section("401 and 403 both classify as auth");
  {
    for (const status of [401, 403]) {
      const stub = await startStub();
      stub.respond = () => ({ status, body: { type: "error", error: { message: "no" } } });

      const gu = await getUser({ key: "e:t", origin: stub.origin });
      eq(`getUser ${status} -> auth`, gu.error && gu.error.kind, "auth");
      const pr = await listOpenPRs({ key: "e:t", workspace: "w", repo: "r", origin: stub.origin });
      eq(`listOpenPRs ${status} -> auth`, pr.error && pr.error.kind, "auth");

      await stub.close();
    }
  }

  section("a query replaces the state filter, and pages keep it");
  {
    const stub = await startStub();
    stub.respond = (req) => {
      const page = Number(new URL(req.url, stub.origin).searchParams.get("page") || 1);
      return { status: 200, body: { size: 60, values: [{ id: page }], next: page < 2 ? `${stub.origin}/n` : undefined } };
    };
    const query = 'state="OPEN" AND (reviewers.uuid="{me}")';
    const r = await listOpenPRs({ key: "e:t", workspace: "w", repo: "r", origin: stub.origin, query });
    const u = new URL(stub.requests[0].url, stub.origin);
    eq("q carries the query verbatim", u.searchParams.get("q"), query);
    eq("...and no separate state filter", u.searchParams.get("state"), null);
    ok("...the whitelist still goes", (u.searchParams.get("fields") || "").includes("values.source.commit.hash"));
    eq("page 2 keeps the query", new URL(stub.requests[1].url, stub.origin).searchParams.get("q"), query);
    eq("both pages' PRs", r.prs.map((p) => p.id), [1, 2]);
    await stub.close();
  }

  section("a 429 is limited, on every call, not transient");
  {
    const stub = await startStub();
    stub.respond = () => ({ status: 429, body: "Rate limit for this resource has been exceeded" });
    const o = { key: "e:t", workspace: "w", repo: "r", prId: 1, origin: stub.origin };
    eq("getUser 429 -> limited", (await getUser(o)).error, { kind: "limited" });
    eq("listOpenPRs 429 -> limited", (await listOpenPRs(o)).error, { kind: "limited" });
    eq("listPRComments 429 -> limited", (await listPRComments(o)).error, { kind: "limited" });
    eq("listPRDiffstat 429 -> limited", (await listPRDiffstat(o)).error, { kind: "limited" });
    await stub.close();
  }

  section("a 500 classifies as transient");
  {
    const stub = await startStub();
    stub.respond = () => ({ status: 500, body: {} });
    const five = await listOpenPRs({ key: "e:t", workspace: "w", repo: "r", origin: stub.origin });
    eq("500 -> transient", five.error && five.error.kind, "transient");
    await stub.close();
  }

  section("a dropped connection classifies as transient");
  {
    const stub = await startStub();
    stub.respond = () => "drop"; // socket destroyed mid-response
    const drop = await getUser({ key: "e:t", origin: stub.origin });
    eq("a dropped socket -> transient", drop.error && drop.error.kind, "transient");
    await stub.close();
  }

  section("an unparseable 200 body is transient, not a dead credential");
  {
    const stub = await startStub();
    stub.respond = () => ({ status: 200, body: "{ not json" });
    const r = await getUser({ key: "e:t", origin: stub.origin });
    eq("garbage 200 -> transient", r.error && r.error.kind, "transient");
    await stub.close();
  }

  done();
}

main();

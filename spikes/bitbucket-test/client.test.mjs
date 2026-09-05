// The BitBucket HTTPS client, driven against a loopback stub -- it never reaches
// api.bitbucket.org (DESIGN 5.2). The stub records every request (method, path,
// headers) so the auth header and the query the client SENDS are assertable, and
// answers with whatever a case needs so the pagination and error paths are exercised
// without the real API. run.sh greps this file to prove every stub reference here
// names the loopback stub, and greps the client to prove it has no mutating verb.

import http from "node:http";
import { getUser, listOpenPRs, listPRComments } from "../../bin/cockpit-bitbucket-client.mjs";
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

  section("listOpenPRs sends state=OPEN and the participants+reviewers expansion");
  {
    const stub = await startStub();
    stub.respond = () => ({ status: 200, body: { values: [{ id: 1 }] } });

    await listOpenPRs({ key: "e:t", workspace: "acme", repo: "web", origin: stub.origin });
    const u = new URL(stub.requests[0].url, stub.origin);
    ok("the path names the workspace and repo", u.pathname === "/2.0/repositories/acme/web/pullrequests", u.pathname);
    eq("state is OPEN", u.searchParams.get("state"), "OPEN");
    eq("fields expands participants and reviewers", u.searchParams.get("fields"), "+values.participants,+values.reviewers");
    eq("pagelen is 50", u.searchParams.get("pagelen"), "50");

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

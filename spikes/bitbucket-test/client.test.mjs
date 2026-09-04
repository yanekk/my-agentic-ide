// The BitBucket HTTPS client, driven against a loopback stub -- it never reaches
// api.bitbucket.org (DESIGN 5.2). The stub records every request (method, path,
// headers) so the auth header and the query the client SENDS are assertable, and
// answers with whatever a case needs so the pagination and error paths are exercised
// without the real API. run.sh greps this file to prove every stub reference here
// names the loopback stub, and greps the client to prove it has no mutating verb.

import http from "node:http";
import { getUser, listOpenPRs } from "../../bin/cockpit-bitbucket-client.mjs";
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

const decodeBasic = (auth) => Buffer.from(String(auth).replace(/^Basic /, ""), "base64").toString("utf8");

async function main() {
  section("the Authorization header is Basic base64(email:api-token)");
  {
    const stub = await startStub();
    stub.respond = () => ({ status: 200, body: { uuid: "{u-1}", nickname: "me", account_id: "a1" } });

    const key = "me@example.com:abc123TOKEN9876";
    await getUser({ key, origin: stub.origin });
    const auth = stub.requests[0].headers.authorization;
    ok("the scheme is Basic", /^Basic /.test(auth || ""), auth);
    eq("it decodes back to the exact credential", decodeBasic(auth), key);

    await stub.close();
  }

  section("a token that itself contains a colon is preserved");
  {
    const stub = await startStub();
    stub.respond = () => ({ status: 200, body: { uuid: "{u}" } });

    const key = "me@example.com:tok:with:colons";
    await getUser({ key, origin: stub.origin });
    const decoded = decodeBasic(stub.requests[0].headers.authorization);
    eq("the whole credential round-trips", decoded, key);
    // The server splits on the FIRST colon: everything after it is the password,
    // colons and all. Proven here so a future "let me just split it client-side"
    // change has a test to answer to.
    eq("email is the part before the first colon", decoded.slice(0, decoded.indexOf(":")), "me@example.com");
    eq("the token keeps its colons", decoded.slice(decoded.indexOf(":") + 1), "tok:with:colons");

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
    ok("the auth header is re-sent on every page", stub.requests.every((q) => /^Basic /.test(q.headers.authorization || "")));

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

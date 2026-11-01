// The judge of wall-check.sh, against planted failures: a checker that cannot say BREACH
// proves nothing however green the real run looks.

import { section, eq, done } from "../agenda-test/harness.mjs";
import { judgeInit, judgeMain, judgeTrial, parseCalls } from "./wall-check-judge.mjs";

section("parseCalls");
{
  const text = [
    JSON.stringify({ message: { content: [{ type: "tool_use", id: "a", name: "Bash", input: { command: "x" } }] } }),
    "not json",
    JSON.stringify({ message: { content: "plain" } }),
    JSON.stringify({ message: { content: [{ type: "tool_result", tool_use_id: "a", is_error: true, content: [{ type: "text", text: "no" }] }] } }),
    JSON.stringify({ message: { content: [{ type: "tool_use", id: "b", name: "Read", input: {} }] } }),
  ].join("\n");
  eq("pairs results, skips junk, keeps an unanswered call", parseCalls(text), [
    { name: "Bash", input: { command: "x" }, result: "no", isError: true },
    { name: "Read", input: {}, result: null, isError: false },
  ]);
}

section("the settings were taken");
const control = { tools: ["Bash", "SendMessage", "ListAgents"], mcp_servers: [] };
const wall = { tools: ["Bash", "Read"], mcp_servers: [], permissionMode: "dontAsk" };
eq("the wall holds", judgeInit({ wall, control }).verdict, "refused");
eq("dropped settings show as open tools", judgeInit({ wall: { ...wall, tools: ["Bash", "SendMessage"] }, control }).verdict, "BREACH");
eq("connectors", judgeInit({ wall: { ...wall, tools: ["mcp__a__b"] }, control }).verdict, "BREACH");
eq("the mode", judgeInit({ wall: { ...wall, permissionMode: "default" }, control }).verdict, "BREACH");
eq("no init is not checkable", judgeInit({ wall: null, control }).verdict, "not checkable");
eq("a blind control is not checkable", judgeInit({ wall, control: { tools: ["Bash"] } }).verdict, "not checkable");

section("the rehearsal");
eq("names both", judgeTrial({ report: "1. echo wc-ok passed\n2. curl example.com blocked (403)", passMarker: "wc-ok", blockedWord: "example.com" }),
  { namesPassed: true, namesBlocked: true, saysBlocked: true });
eq("silent on the block", judgeTrial({ report: "1. wc-ok passed", passMarker: "wc-ok", blockedWord: "example.com" }).namesBlocked, false);

section("main");
eq("unchanged", judgeMain({ before: "a", after: "a" }), "unchanged");
eq("an ordinary merge", judgeMain({ before: "a", after: "b", oldTipKept: true, holdsWallCheckCommit: false }), "moved by someone else");
eq("our commit on main", judgeMain({ before: "a", after: "b", oldTipKept: true, holdsWallCheckCommit: true }), "BREACH");
eq("the old tip dropped", judgeMain({ before: "a", after: "b", oldTipKept: false, holdsWallCheckCommit: false }), "BREACH");

done();

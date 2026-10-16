#!/usr/bin/env node
// Switch task issues between mode:auto and mode:manual.
// Usage: node scripts/github/set-mode.mjs auto T-29 T-30   (flip specific tasks)
//        node scripts/github/set-mode.mjs sync             (make every open issue match the Mode lines in TASKS.md)
import { parseTasks, gh, issueIndex } from "./tasks.mjs";

const [mode, ...rest] = process.argv.slice(2);
if (!["auto", "manual"].includes(mode) && mode !== "sync") {
  console.error("usage: set-mode.mjs <auto|manual> T-XX ...   or   set-mode.mjs sync");
  process.exit(1);
}
const index = issueIndex();
const wanted = mode === "sync"
  ? parseTasks().map((t) => [t.id, t.mode])
  : rest.map((id) => [id, mode]);

for (const [id, m] of wanted) {
  const issue = index.get(id);
  if (!issue) { console.warn(`${id}: no issue found`); continue; }
  if (issue.state !== "OPEN") continue;
  const other = m === "auto" ? "manual" : "auto";
  if (issue.labels.includes(`mode:${m}`) && !issue.labels.includes(`mode:${other}`)) continue;
  gh(["issue", "edit", String(issue.number), "--add-label", `mode:${m}`, "--remove-label", `mode:${other}`]);
  console.log(`${id} (#${issue.number}) → mode:${m}`);
}

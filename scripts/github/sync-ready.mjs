#!/usr/bin/env node
// Add `ready` to open task issues whose dependencies are all closed; remove it otherwise.
// Runs in GitHub Actions after every merge, or by hand: node scripts/github/sync-ready.mjs [--dry-run]
import { parseTasks, gh, issueIndex } from "./tasks.mjs";

const dry = process.argv.includes("--dry-run");
const tasks = parseTasks();
const index = issueIndex();
let added = 0, removed = 0;

for (const t of tasks) {
  const issue = index.get(t.id);
  if (!issue || issue.state !== "OPEN") continue;
  const missing = t.deps.filter((d) => !index.has(d));
  if (missing.length) console.warn(`${t.id}: no issue found for ${missing.join(", ")}`);
  const isReady = t.deps.every((d) => index.get(d)?.state === "CLOSED");
  const hasLabel = issue.labels.includes("ready");
  if (isReady && !hasLabel) {
    console.log(`+ ready  ${t.id} (#${issue.number})`);
    if (!dry) gh(["issue", "edit", String(issue.number), "--add-label", "ready"]);
    added++;
  } else if (!isReady && hasLabel) {
    console.log(`- ready  ${t.id} (#${issue.number})`);
    if (!dry) gh(["issue", "edit", String(issue.number), "--remove-label", "ready"]);
    removed++;
  }
}
console.log(`ready labels: +${added} -${removed}${dry ? " (dry run)" : ""}`);

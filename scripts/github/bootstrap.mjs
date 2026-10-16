#!/usr/bin/env node
// Create labels and one GitHub issue per task in TASKS.md. Safe to re-run: existing T-XX issues are skipped.
// Usage (repo root, gh logged in):  node scripts/github/bootstrap.mjs [--dry-run]
import { parseTasks, gh, issueIndex } from "./tasks.mjs";

const dry = process.argv.includes("--dry-run");
const tasks = parseTasks();

const labels = [
  ["agent:claude", "D97757", "Claude Code lane"],
  ["agent:antigravity", "4285F4", "Antigravity lane"],
  ["agent:opencode", "6E7781", "OpenCode lane"],
  ["mode:auto", "1D9E75", "Picked up by scheduled automation"],
  ["mode:manual", "D85A30", "Owner starts and supervises"],
  ["ready", "16A34A", "All dependencies closed"],
  ["in-review", "BA7517", "PR open, waiting for review"],
  ["changes-requested", "E24B4A", "Review failed; builder fixes first"],
  ["reviewed", "534AB7", "Reviewer posted PASS/FAIL (PR label)"],
  ["bug", "A32D2D", "Found by smoke test or review"],
  ...["M0", "M1", "M2", "M3", "M4", "M5", "M6", "M7"].map((m) => [m, "888780", `Milestone ${m}`]),
];

console.log(`${tasks.length} tasks parsed from TASKS.md`);
if (dry) {
  for (const t of tasks) {
    console.log(`${t.id} [agent:${t.agent}, mode:${t.mode}, ${t.milestone}] deps=${t.deps.join(",") || "-"}  ${t.title}`);
  }
  const counts = tasks.reduce((a, t) => ((a[`${t.agent}/${t.mode}`] = (a[`${t.agent}/${t.mode}`] ?? 0) + 1), a), {});
  console.log(counts);
  process.exit(0);
}

for (const [name, color, description] of labels) {
  gh(["label", "create", name, "--color", color, "--description", description, "--force"]);
}
console.log(`${labels.length} labels ensured`);

let index = issueIndex();
for (const t of tasks) {
  if (index.has(t.id)) {
    console.log(`skip ${t.id} (issue #${index.get(t.id).number} exists)`);
    continue;
  }
  const body = `${t.spec}\n\n---\nSpec source: \`TASKS.md\` → ${t.id}. Rules: \`AGENTS.md\`.`;
  const url = gh(["issue", "create", "--title", `${t.id} ${t.title}`, "--body", body,
    "--label", `agent:${t.agent}`, "--label", `mode:${t.mode}`, "--label", t.milestone]);
  console.log(`created ${t.id} → ${url}`);
}

// Second pass: link dependencies by issue number (for humans; sync-ready reads TASKS.md).
index = issueIndex();
for (const t of tasks) {
  if (!t.deps.length) continue;
  const issue = index.get(t.id);
  const links = t.deps.map((d) => (index.has(d) ? `#${index.get(d).number}` : d)).join(", ");
  const current = gh(["issue", "view", String(issue.number), "--json", "body", "-q", ".body"]);
  if (current.includes("Blocked by:")) continue;
  gh(["issue", "edit", String(issue.number), "--body", `${current}\nBlocked by: ${links}`]);
}
console.log("Dependencies linked. Now run: node scripts/github/sync-ready.mjs");

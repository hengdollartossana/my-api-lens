// Shared helpers: parse TASKS.md and talk to GitHub through the gh CLI.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

export function parseTasks(path = "TASKS.md") {
  const text = readFileSync(path, "utf8");
  const sections = text.split(/^### (?=T-\d{2} )/m).slice(1);
  return sections.map((raw) => {
    const body = raw.split(/^(?:---|## )/m)[0].trim();
    const [heading, ...rest] = body.split("\n");
    const id = heading.match(/^T-\d{2}/)[0];
    const title = heading.slice(id.length).trim();
    const meta = rest.find((l) => l.startsWith("Agent:")) ?? "";
    const agent = meta.match(/Agent:\s*(\w+)/)?.[1];
    const mode = meta.match(/Mode:\s*(\w+)/)?.[1];
    const milestone = meta.match(/Milestone:\s*(M\d)/)?.[1];
    const depLine = rest.find((l) => l.startsWith("Depends on:")) ?? "";
    const deps = depLine.match(/T-\d{2}/g) ?? [];
    if (!agent || !mode || !milestone) throw new Error(`${id}: missing Agent/Mode/Milestone line`);
    return { id, title, agent, mode, milestone, deps, spec: rest.join("\n").trim() };
  });
}

export function gh(args, { json = false } = {}) {
  const out = execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return json ? JSON.parse(out || "null") : out.trim();
}

// Map "T-XX" -> issue {number, state, labels} for issues created by bootstrap (title starts with T-XX).
export function issueIndex() {
  const issues = gh(["issue", "list", "--state", "all", "--limit", "500", "--json", "number,title,state,labels"], { json: true });
  const map = new Map();
  for (const i of issues) {
    const id = i.title.match(/^T-\d{2}\b/)?.[0];
    if (id) map.set(id, { number: i.number, state: i.state, labels: i.labels.map((l) => l.name) });
  }
  return map;
}

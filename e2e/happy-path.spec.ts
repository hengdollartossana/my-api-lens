import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { Pool } from "pg";

/**
 * The whole product in one pass, against the local mock API (deliberate spec mismatches):
 * login -> import spec -> environment + login_flow -> run -> diff -> approve with known issues
 * -> context pack export -> Flutter zip download.
 *
 * Steps that have no screen yet (saving the login_flow recipe) use the same API the app uses.
 */

const mockPort = Number(process.env.MOCK_API_PORT ?? 4010);
const projectName = `e2e-${Date.now()}`;
let projectId = "";

test.afterAll(async () => {
  if (!projectId || !process.env.DATABASE_URL) return;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query("delete from projects where id = $1", [projectId]);
  await pool.end();
});

test("login to Flutter zip", async ({ page }) => {
  // 1. Login
  await page.goto("/login");
  // The dev build can hydrate after the first keystrokes; retry until the controlled input took.
  const logIn = page.getByRole("button", { name: "Log In" });
  await expect(async () => {
    await page.locator("#password").fill(process.env.APP_PASSWORD ?? "");
    await expect(logIn).toBeEnabled({ timeout: 1000 });
  }).toPass();
  await logIn.click();
  await expect(page).not.toHaveURL(/\/login/);

  // 2. Import the messy spec from a file
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByRole("tab", { name: "Upload file" }).click();
  await page.locator("#spec-file").setInputFiles("fixtures/specs/messy-v3.json");
  await page.locator("#project-name").fill(projectName);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("link", { name: new RegExp(projectName) }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  projectId = page.url().split("/").pop() as string;
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();

  // 3. Environment pointing at the mock API
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.getByRole("button", { name: "New environment" }).click();
  await page.locator("#env-name").fill("mock");
  await page.locator("#env-url").fill(`http://localhost:${mockPort}`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("cell", { name: "mock", exact: true })).toBeVisible();

  // 3b. login_flow auth recipe (no screen yet): demo/demo against the mock's login endpoint
  const saved = await page.request.put(`/api/projects/${projectId}/auth-recipes`, {
    data: {
      environmentId: null,
      recipe: { type: "login_flow", loginPath: "/api/v1/auth/login", tokenPath: "token" },
      secret: JSON.stringify({ username: "demo", password: "demo" }),
    },
  });
  expect(saved.ok()).toBeTruthy();

  // 4. Run the User module
  await page.goto(`/projects/${projectId}`);
  await page.getByRole("link", { name: /^User/ }).click();
  await page.getByRole("button", { name: "Run module" }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await expect(page.getByText("Done", { exact: true }).first()).toBeVisible();
  const moduleUrl = page.url();

  // 5. Diff screen shows what the mock gets wrong
  await page.getByRole("tab", { name: "Diff" }).click();
  await expect(page.getByText("Extra field").first()).toBeVisible();
  await expect(page.getByText("internalNote").first()).toBeVisible();

  // 6. Approval is blocked by errors; approve with known issues
  await page.goto(moduleUrl);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Approve with known issues" }).click();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();

  // 7. Context pack: copy and download are the same text as the preview
  await page.getByRole("tab", { name: "Context pack" }).click();
  const preview = page.locator("pre");
  await expect(preview).toContainText("## User");
  await expect(page.getByText(/tokens/)).toBeVisible();
  const previewText = (await preview.textContent()) ?? "";
  const mdDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .md" }).click();
  const md = await mdDownload;
  expect(md.suggestedFilename()).toBe("api-context.md");
  expect(readFileSync(await md.path(), "utf8")).toBe(previewText);

  // 8. Flutter codegen: the zip holds exactly the previewed files
  await page.getByRole("tab", { name: "Codegen" }).click();
  await expect(page.getByText(/\d+ files/)).toBeVisible();
  await expect(page.getByRole("button", { name: "lib/api/user/user_client.dart" })).toBeVisible();
  const zipDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download zip" }).click();
  const zipFile = await zipDownload;
  expect(zipFile.suggestedFilename()).toMatch(/-flutter\.zip$/);
  const zip = await JSZip.loadAsync(readFileSync(await zipFile.path()));
  const zipped = Object.keys(zip.files).filter((n) => !zip.files[n]?.dir);
  const listed = await page
    .locator("ul button[title]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("title")));
  expect(zipped.sort()).toEqual(listed.sort());
  expect(zipped).toContain("lib/api/user/user_client.dart");
  const client = await zip.file("lib/api/user/user_client.dart")?.async("string");
  expect(client).toContain("class UserClient");
});

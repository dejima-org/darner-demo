// SPDX-License-Identifier: GPL-3.0-or-later
// A visitor's whole visit, in Chromium, against `make build` served as nginx
// serves it: start a task, see its output arrive, message it, stop it, clear it,
// and run the self-test, with no console error and no CSP violation.
//
//   node test/browser.mjs [screenshot dir]
//
// Needs Playwright and its Chromium, so it isn't run in CI.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 8765;
const base = `http://127.0.0.1:${PORT}`;
const shots = process.argv[2];
const server = spawn("python3", ["tools/serve.py", "public", String(PORT)], { stdio: "inherit" });
await new Promise((resolve) => setTimeout(resolve, 500));

const browser = await chromium.launch();
const problems = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  const shot = async (name) => shots && page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });

  await page.goto(base);
  assert.match(await page.textContent("main"), /No sessions/);
  await shot("1-sessions-empty");

  await page.click("a.new");
  await page.waitForSelector("#preview dt");
  await page.check('input[name=configs][value="recipe-service"]');
  await page.check('input[name=blurbs][value="search"]');
  await page.fill("#task", "Add the banana bread recipe from https://recipes.example.org/banana-bread");
  await page.fill("#name", "banana");
  await page.waitForFunction(() => document.querySelector("#preview")?.textContent.includes("cline"));
  assert.match(await page.textContent("#preview-blurbs"), /recipe-service/);
  await shot("2-new-task");

  await page.click("button[type=submit]");
  await page.waitForURL(/\/sessions\/dn-[a-z2-7]{5}$/);
  const id = page.url().split("/").pop();
  assert.equal(await page.textContent("h1"), "dn-banana");
  assert.match(await page.textContent(".summary"), new RegExp(`^${id}\\. Started by web, 0m ago\\.`));
  assert.match(await page.textContent(".latest"), /Nothing yet/);
  assert.match(await page.textContent("section.started"), /Config setsrecipe-service/);
  await shot("3-session-running");

  await page.waitForSelector(".latest .event.output", { timeout: 20000 });
  assert.match(await page.textContent(".latest"), /no model on the other end/);
  await shot("4-session-output");

  await page.goto(base);
  assert.match(await page.textContent("li.card"), new RegExp(`dn-banana\\s*running\\s*${id}`));
  await shot("4b-sessions-running");
  await page.goto(`${base}/sessions/${id}`);

  await page.fill("#message", "Use metric units");
  await page.click("form[data-action] button[type=submit]");
  await page.waitForSelector(".sent:not([hidden])");

  page.once("dialog", (d) => d.accept());
  await page.click("button[data-post$=stop]");
  await page.waitForSelector('.summary:has-text("Ended")', { timeout: 10000 });
  assert.equal(await page.textContent("h1"), id);
  assert.ok(await page.isVisible(".latest .event.output"));
  await shot("5-session-ended");

  const zip = await page.waitForEvent("download", { trigger: page.click("a[download]") }).catch(() => null);
  assert.ok(zip ?? (await page.$("a[download]")), "the zip downloads");

  await page.goto(base);
  assert.match(await page.textContent(".ended-list"), new RegExp(id));
  await shot("6-sessions-list");

  await page.goto(`${base}/sessions/${id}`);
  page.once("dialog", (d) => d.accept());
  await page.click("button[data-post$=clear]");
  await page.waitForURL(`${base}/`);
  assert.match(await page.textContent("main"), /No sessions/);

  await page.goto(`${base}/selftest`);
  await page.click("button[data-post='/selftest']");
  await page.waitForURL(/\/sessions\/dn-/);
  assert.match(await page.textContent(".latest"), /Frontend self-test/);
  await shot("7-selftest");

  await page.goto(`${base}/sessions/dn-nopes`);
  assert.match(await page.textContent("main"), /never existed here/);

  for (const [path, heading] of [["/blurbs", "Context blurbs"], ["/blurbs/recipe-service", "recipe-service"],
    ["/configs", "Config sets"], ["/configs/recipe-service", "recipe-service"]]) {
    const response = await page.goto(base + path);
    assert.equal(response.status(), 200, path);
    assert.match(await page.textContent("main h1"), new RegExp(`^${heading}`), path);
  }
  await page.goto(`${base}/configs`);
  assert.match(await page.textContent(".names"), /local Self-hosted Cline session/);
  await page.goto(`${base}/configs/local`);
  assert.match(await page.textContent("main"), /Self-hosted Cline session/);
  await shot("8-config");
  assert.deepEqual(problems, []);
  console.log("ok: the demo works end to end");
} finally {
  await browser.close();
  server.kill();
}

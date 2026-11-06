// SPDX-License-Identifier: GPL-3.0-or-later
// demo.js answers the new-task form as darner does. The fixtures are darner-web's
// own answers to the same forms, captured by tools/generate.py.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as model from "../src/model.js";

const { data, previews } = JSON.parse(readFileSync(new URL("fixtures/previews.json", import.meta.url)));
const form = (body) => ({ task: "", ...body });

for (const { body, status, answer } of previews) {
  test(`preview ${JSON.stringify(body)}`, () => {
    assert.deepEqual(model.preview(data, form(body)), { status, body: answer });
  });
}

test("a start needs a task", () => {
  assert.deepEqual(model.start(data, form({}), []), { status: 400, body: { error: "Say what the task is." } });
});

test("a start records what the session was started with", () => {
  const { status, body } = model.start(data, form({ task: "go", configs: ["recipe-service"], blurbs: ["search"], name: "dn-mine" }), [], 100);
  assert.equal(status, 200);
  assert.match(body.id, /^dn-[a-z2-7]{5}$/);
  assert.equal(body.name, "mine");
  assert.deepEqual(body.started_with.configs, ["recipe-service"]);
  assert.deepEqual(body.started_with.blurbs, ["recipe-service", "search"]);
  assert.deepEqual(body.started_with.files, ["recipe-service-api-token", "add_recipe.py"]);
});

test("a name is held until its session is cleared", () => {
  const held = { id: "dn-aaaaa", name: "mine", created: 0, kind: "task", stopped: null };
  assert.equal(model.start(data, form({ task: "go", name: "mine" }), [held], 1).body.error, "dn-mine is already the name of an open session");
  assert.equal(
    model.start(data, form({ task: "go", name: "mine" }), [{ ...held, stopped: 1 }], 2).body.error,
    "dn-mine is still held by dn-aaaaa, which has ended; clear it to free the name",
  );
});

test("a session delivers its output after a while, and keeps it once stopped", () => {
  const s = { id: "dn-aaaaa", created: 0, kind: "task", stopped: null };
  assert.equal(model.view(s, model.OUTPUT_AFTER - 1), "running");
  assert.equal(model.view(s, model.OUTPUT_AFTER), "running-output");
  assert.equal(model.view({ ...s, stopped: 1 }, 100), "ended");
  assert.equal(model.view({ ...s, stopped: model.OUTPUT_AFTER + 1 }, 100), "ended-output");
  assert.equal(model.view(undefined), "gone");
});

test("ages read as darner-web's", () => {
  assert.deepEqual([59, 60, 3600 + 120, 86400 * 2 + 3600].map(model.age), ["0m", "1m", "1h02m", "2d1h"]);
});

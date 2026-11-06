// SPDX-License-Identifier: GPL-3.0-or-later
// What darner-web and darner-api would answer, for the demo's browser to play
// both. `data` is what tools/generate.py captured from darner itself: its config
// sets combined, its blurbs, its catalog and the rules and messages its checks
// use. The checks are darner-api's _build, _session_name and check_job_harness,
// in their order, and test/model.test.mjs holds them to darner's own answers.

// The seconds a demo session takes to deliver its output.
export const OUTPUT_AFTER = 8;

class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// A value as Python's repr shows it in darner's messages.
function repr(value) {
  if (typeof value !== "string") return String(value);
  return value.includes("'") && !value.includes('"') ? `"${value}"` : `'${value.replaceAll("'", "\\'")}'`;
}

const full = (pattern) => new RegExp(`^(?:${pattern})$`);

// darner-web's _words: a form field as a list, split on commas and spaces.
export function words(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string" && v);
  if (typeof value !== "string") return [];
  return value.replaceAll(",", " ").split(/\s+/).filter(Boolean);
}

function unique(items) {
  return [...new Set(items)];
}

function withoutPort(domain) {
  const lower = domain.toLowerCase();
  const at = lower.lastIndexOf(":");
  if (at < 0) return lower;
  const port = lower.slice(at + 1);
  return /^\d{1,5}$/.test(port) && Number(port) > 0 && Number(port) < 65536 ? lower.slice(0, at) : lower;
}

// darner-web's _task_request: the form as the API's request body.
export function request(form) {
  const body = {
    task: typeof form.task === "string" ? form.task : "",
    blurbs: words(form.blurbs),
    configs: words(form.configs),
    grants: { domains: words(form.domains), internal: words(form.internal), dependencies: words(form.dependencies) },
  };
  for (const key of ["harness", "backend", "model", "effort", "context_window", "network", "name"]) {
    if (typeof form[key] === "string" && form[key].trim()) body[key] = form[key].trim();
  }
  return body;
}

// darner-api's _build: the job a request makes, and the config sets and blurbs it was made from.
function build(data, body) {
  const overridden = new Set(data.singles.filter((key) => body[key] != null));
  const combo = data.sets[body.configs.join(",")];
  if (!combo) {
    const unknown = body.configs.find((name) => !data.sets[name]);
    throw new Refused(400, `unknown config set ${repr(unknown)} (available: ${Object.keys(data.sets).filter((k) => k && !k.includes(",")).join(", ") || "none"})`);
  }
  const conflict = combo.conflicts.find(([key]) => !overridden.has(key));
  if (conflict) throw new Refused(400, conflict[1]);
  const sets = combo.sets;
  const internal = unique([...sets.internal, ...body.grants.internal].map(withoutPort));
  const domains = unique([...sets.domains, ...body.grants.domains, ...internal].map(withoutPort));
  const names = unique([...sets.blurbs, ...body.blurbs]);
  for (const name of names) {
    if (!(name in data.blurbs)) throw new Refused(400, `unknown context blurb ${repr(name)} (available: ${Object.keys(data.blurbs).join(", ")})`);
  }
  const job = { domains, internal_domains: internal, dependencies: unique([...sets.dependencies, ...body.grants.dependencies]), files: sets.files };
  for (const key of data.singles) {
    let value = body[key] != null ? body[key] : sets[key];
    if (key === "context_window" && typeof value === "string" && /^[0-9]+$/.test(value)) value = Number(value);
    if (value != null) job[key] = value;
  }
  validate(data, job);
  policy(data, job);
  return { job, sets, blurbs: names.map((name) => ({ name, text: data.blurbs[name] })) };
}

// darner's _MODEL, which Python writes with a ] first in its class and JavaScript can't.
const MODEL = /^[A-Za-z0-9][\][A-Za-z0-9._:/-]{0,199}$/;

// darner's validate_job, for what a request can set.
function validate(data, job) {
  const [low, high] = data.context_window;
  for (const [key, check, what] of [
    ["model", (v) => MODEL.test(v), "model"],
    ["effort", (v) => full(data.effort).test(v), "effort level"],
    ["context_window", (v) => Number.isInteger(v) && v >= low && v <= high, `context window (${low} to ${high} tokens)`],
    ["network", (v) => data.networks.includes(v), `network (${data.networks.join(", ")})`],
  ]) {
    if (job[key] != null && !check(job[key])) throw new Refused(400, `not a valid ${what}: ${repr(job[key])}`);
  }
  const list = (key, check, what) => {
    if (job[key].length > data.max_grants) throw new Refused(400, `${key} must be a list of at most ${data.max_grants} entries`);
    for (const item of job[key]) if (!check(item)) throw new Refused(400, `not a valid ${what}: ${repr(item)}`);
  };
  const domain = (v) => full(data.domain).test(v);
  list("domains", domain, "domain");
  list("internal_domains", domain, "internal domain");
  list("dependencies", (v) => full(data.dependency).test(v) || full(data.tarball).test(v), "dependency spec");
  for (const key of ["harness", "backend"]) {
    if (job[key] != null && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(job[key])) throw new Refused(400, `not a valid ${key} name: ${repr(job[key])}`);
  }
}

// The demo's API has no [policy], so only the dependency kinds it allows by default limit a task.
function policy(data, job) {
  for (const dependency of job.dependencies) {
    const kind = dependency.split(":")[0];
    if (!data.dependency_kinds.includes(kind)) throw new Refused(403, `dependency kind not permitted: ${kind} (allow_dependency_kinds)`);
  }
}

// darner-api's _session_name.
function sessionName(data, body) {
  if (body.name == null || body.name === "") return null;
  const name = body.name.trim().toLowerCase().replace(/^dn-/, "");
  if (!full(data.session_name).test(name) || /^dn-[a-z2-7]{5}$/.test(`dn-${name}`)) throw new Refused(400, data.name_rule);
  return name;
}

function nameTaken(sessions, name, now) {
  const held = sessions.find((s) => s.name === name);
  if (!held) return null;
  return view(held, now).startsWith("ended")
    ? `dn-${name} is still held by ${held.id}, which has ended; clear it to free the name`
    : `dn-${name} is already the name of an open session`;
}

// darner-api's check_job_harness, against the launcher's catalog.
function checkHarness(data, job) {
  const harness = job.harness || data.catalog.default_harness;
  const known = data.catalog.options[harness];
  if (!known) return;
  const defaults = data.catalog.defaults[harness] || {};
  const [backend, effort, contextWindow] = ["backend", "effort", "context_window"].map((k) => job[k] || defaults[k] || null);
  if (backend != null && !known.backends.includes(backend)) throw new Refused(400, `${harness} can't use the ${backend} backend, only ${known.backends.join(", ")}`);
  if (effort != null && Array.isArray(known.efforts) && known.efforts.length === 0) throw new Refused(400, `${harness} takes no effort level`);
  if (effort != null && Array.isArray(known.efforts) && !known.efforts.includes(effort)) throw new Refused(400, `${harness} has no effort level ${effort}, only ${known.efforts.join(", ")}`);
  if (contextWindow != null && !known.context_window) throw new Refused(400, `${harness} takes no context window`);
}

function answer(fn) {
  try {
    return { status: 200, body: fn() };
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    return { status: e.status, body: { error: e.message } };
  }
}

// POST /tasks/preview, from darner-web's new-task form.
export function preview(data, form, sessions = [], now = Date.now() / 1000) {
  return answer(() => {
    const body = request(form);
    if (!body.task.trim()) body.task = "-";
    const { job, sets, blurbs } = build(data, body);
    const name = sessionName(data, body);
    const taken = name != null && nameTaken(sessions, name, now);
    if (taken) throw new Refused(409, taken);
    checkHarness(data, job);
    const fromConfigs = {};
    for (const key of data.singles) {
      const value = sets[key];
      if (value != null) fromConfigs[key] = key === "context_window" && /^[0-9]+$/.test(value) ? Number(value) : value;
    }
    const settings = {};
    for (const key of data.singles) if (key in job) settings[key] = job[key];
    return {
      name, settings, from_configs: fromConfigs, domains: job.domains, internal_domains: job.internal_domains,
      dependencies: job.dependencies, files: job.files, blurbs,
    };
  });
}

function newId() {
  const letters = "abcdefghijklmnopqrstuvwxyz234567";
  const random = crypto.getRandomValues(new Uint8Array(5));
  return `dn-${[...random].map((n) => letters[n % 32]).join("")}`;
}

// POST /tasks: a new session, as darner-web and then darner-api check it, or why not.
export function start(data, form, sessions, now = Date.now() / 1000) {
  return answer(() => {
    if (typeof form.task !== "string" || !form.task.trim()) throw new Refused(400, "Say what the task is.");
    const body = request(form);
    const { job, blurbs } = build(data, body);
    const name = sessionName(data, body);
    checkHarness(data, job);
    const taken = name != null && nameTaken(sessions, name, now);
    if (taken) throw new Refused(409, taken);
    const recorded = { ...job, configs: body.configs, blurbs: blurbs.map((b) => b.name) };
    const startedWith = {};
    for (const key of data.started_with) {
      const value = recorded[key];
      if (value != null && value !== "" && !(Array.isArray(value) && value.length === 0) && value !== 0) startedWith[key] = value;
    }
    let id = newId();
    while (sessions.some((s) => s.id === id)) id = newId();
    return { id, name, created: now, started_with: startedWith, kind: "task", stopped: null };
  });
}

export function selftest(sessions, now = Date.now() / 1000) {
  let id = newId();
  while (sessions.some((s) => s.id === id)) id = newId();
  return { id, name: null, created: now, started_with: {}, kind: "selftest", stopped: now };
}

// Which of the session page's captured views a session shows now.
export function view(session, now = Date.now() / 1000) {
  if (!session) return "gone";
  if (session.kind === "selftest") return "selftest-session";
  const delivered = (session.stopped ?? now) >= session.created + OUTPUT_AFTER;
  if (session.stopped != null) return delivered ? "ended-output" : "ended";
  return delivered ? "running-output" : "running";
}

// darner-web's _age.
export function age(seconds) {
  let minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  minutes %= 60;
  return hours < 24 ? `${hours}h${String(minutes).padStart(2, "0")}m` : `${Math.floor(hours / 24)}d${hours % 24}h`;
}

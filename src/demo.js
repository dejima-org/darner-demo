// SPDX-License-Identifier: GPL-3.0-or-later
// The demo's darner-web and darner-api, in the browser. Every page is one
// darner-web served while tools/generate.py drove it; this fills in the
// visitor's sessions, kept in this browser's localStorage, and answers what
// darner-web's own app.js asks the server, which runs after this.
//
// Like app.js, this inserts no HTML: it removes the captured views a page
// doesn't need, and sets text.
import * as model from "./model.js";

const data = JSON.parse(document.getElementById("demo-data").textContent);
const KEY = "darner-demo";
const now = () => Date.now() / 1000;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { sessions: saved.sessions ?? [], refs: saved.refs ?? [] };
  } catch {
    return { sessions: [], refs: [] };
  }
}

function save(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

const title = (s) => (s.name ? `dn-${s.name}` : s.id);
const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

// Each captured page names its session dn-zzzzz, or dn-example by its name.
function rename(root, session) {
  const swap = (text) => text.replaceAll(`dn-${data.name}`, title(session)).replaceAll(data.id, session.id);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) node.nodeValue = swap(node.nodeValue);
  for (const el of root.querySelectorAll("[href], [data-post], [data-action], [data-upload], [data-confirm]")) {
    for (const attr of ["href", "data-post", "data-action", "data-upload", "data-confirm"]) {
      if (el.hasAttribute(attr)) el.setAttribute(attr, swap(el.getAttribute(attr)));
    }
  }
}

function keep(name) {
  for (const v of document.querySelectorAll("main > [data-view]")) if (v.dataset.view !== name) v.remove();
  return document.querySelector(`main > [data-view="${name}"]`);
}

function ages(root, session) {
  const since = (t) => `${model.age(now() - t)} ago`;
  for (const node of root.querySelectorAll(".summary, .card .meta")) {
    for (const text of node.childNodes) {
      if (text.nodeType === Node.TEXT_NODE) text.nodeValue = text.nodeValue.replace(/\b\d+(m|h\d\dm|d\d+h) ago/, since(session.created));
    }
  }
  for (const when of root.querySelectorAll("details.event .when")) {
    const ended = when.closest("details").classList.contains("ended");
    when.textContent = since(ended && session.stopped ? session.stopped : session.created + model.OUTPUT_AFTER);
  }
}

function startedWith(root, session) {
  const section = root.querySelector("section.started");
  if (!section) return;
  const entries = Object.entries(data.labels).filter(([key]) => key in session.started_with);
  if (!entries.length) return section.remove();
  const list = section.querySelector("dl");
  list.replaceChildren();
  for (const [key, label] of entries) {
    const value = session.started_with[key];
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = Array.isArray(value) ? value.join(", ") : String(value);
    list.append(dt, dd);
  }
}

function sessionPage(id) {
  const session = load().sessions.find((s) => s.id === id);
  const name = model.view(session);
  const shown = keep(name);
  const fake = session ?? { id, name: null, created: now(), started_with: {}, stopped: null };
  if (name.startsWith("running") && !session.name) {
    // Captured with a name, which a running session's summary leads with.
    const summary = shown.querySelector(".summary");
    summary.firstElementChild.remove();
    summary.firstChild.nodeValue = summary.firstChild.nodeValue.replace(/^\. /, "");
  }
  rename(shown, fake);
  ages(shown, fake);
  if (session) startedWith(shown, session);
  document.title = `${name === "gone" ? id : title(fake)} · darner`;
  if (name === "gone") {
    delete document.body.dataset.state;
    delete document.body.dataset.version;
  } else {
    document.body.dataset.state = `/state/sessions/${id}`;
    document.body.dataset.version = name;
  }
}

function sessionsPage() {
  const sessions = load().sessions;
  const open = sessions.filter((s) => s.stopped == null && s.kind === "task");
  const ended = sessions.filter((s) => !open.includes(s));
  const shown = keep(sessions.length ? "list" : "empty");
  document.body.dataset.version = listVersion(sessions);
  if (!sessions.length) return;
  const card = shown.querySelector("li.card");
  const item = shown.querySelector(".ended-list li");
  for (const s of open) {
    const copy = card.cloneNode(true);
    if (!s.name) copy.querySelector(".meta.id").remove();
    rename(copy, s);
    ages(copy, s);
    card.parentElement.append(copy);
  }
  for (const s of ended) {
    const copy = item.cloneNode(true);
    rename(copy, s);
    item.parentElement.append(copy);
  }
  card.remove();
  item.remove();
  if (!open.length) shown.querySelector("ul.cards").remove();
  if (!ended.length) {
    shown.querySelector(".ended-list").previousElementSibling.remove();
    shown.querySelector(".ended-list").remove();
  }
}

function listVersion(sessions) {
  return JSON.stringify(sessions.map((s) => [s.id, s.stopped == null]));
}

// What app.js asks of darner-web, answered here.
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function body(init) {
  try {
    return JSON.parse(init?.body ?? "{}");
  } catch {
    return {};
  }
}

const routes = [
  ["POST", /^\/tasks\/preview$/, async (_, init) => {
    const answer = model.preview(data, await body(init), load().sessions);
    return json(answer.body, answer.status);
  }],
  ["POST", /^\/tasks$/, async (_, init) => {
    const form = await body(init);
    const state = load();
    if (state.refs.includes(form.ref)) {
      const started = state.sessions.find((s) => s.ref === form.ref);
      return json({ error: `This form already started ${started?.id ?? "a task"}. Reload the page to start another task.` }, 409);
    }
    const answer = model.start(data, form, state.sessions);
    if (answer.status !== 200) return json(answer.body, answer.status);
    // Long enough to see what a start says while it waits.
    await sleep(2);
    state.sessions.push({ ...answer.body, ref: form.ref });
    state.refs.push(form.ref);
    save(state);
    return json({ location: `/sessions/${answer.body.id}` });
  }],
  ["POST", /^\/selftest$/, async () => {
    const state = load();
    const session = model.selftest(state.sessions);
    state.sessions.push(session);
    save(state);
    return json({ location: `/sessions/${session.id}` });
  }],
  ["POST", /^\/sessions\/(dn-[a-z2-7]{5})\/(message|check|files|stop|clear)$/, async (match, init) => {
    const [, id, action] = match;
    const state = load();
    const session = state.sessions.find((s) => s.id === id);
    if (!session) return json({ error: `no session ${id}` }, 404);
    if (action === "clear") {
      state.sessions = state.sessions.filter((s) => s !== session);
      save(state);
      return json({ location: "/" });
    }
    if (action === "message" && !(await body(init)).text?.trim()) return json({ error: "Write a message first." }, 400);
    if (action === "stop") {
      if (session.stopped != null) return json({ error: `${id} is not running` }, 409);
      await sleep(2);
      session.stopped = now();
      save(state);
    }
    return json({ location: null, result: null });
  }],
  ["GET", /^\/state\/$/, async () => json({ version: listVersion(load().sessions) })],
  ["GET", /^\/state\/sessions\/(dn-[a-z2-7]{5})$/, async (match) => {
    return json({ version: model.view(load().sessions.find((s) => s.id === match[1])) });
  }],
];

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  const method = (init.method ?? "GET").toUpperCase();
  if (url.origin === location.origin) {
    for (const [m, pattern, handle] of routes) {
      const match = url.pathname.match(pattern);
      if (m === method && match) return handle(match, init);
    }
    if (method !== "GET") return json({ error: "The demo doesn't do that." }, 404);
  }
  return realFetch(input, init);
};

const path = location.pathname.replace(/\.html$/, "");
const session = path.match(/^\/sessions\/(dn-[a-z0-9-]+)$/);
if (session) sessionPage(session[1]);
else if (path === "/" || path === "/index") sessionsPage();

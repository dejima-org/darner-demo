#!/usr/bin/env python3
"""Generate site/ by running darner's own API and darner-web in-process.

    <darner>/.venv/bin/python tools/generate.py --darner <darner> --dejima <dejima>

<darner> is a darner checkout with its test dependencies installed in .venv, and
<dejima> a dejima checkout, each at the release to show. darner's own API and
darner-web serve every page captured here. The launcher is a stub, but its catalog is darner-launch's own,
read from the dejima checkout's manifests, and the demo task is started,
delivers its output and is stopped through the API as a real one is.
"""

import argparse
import asyncio
import contextlib
import datetime
import io
import itertools
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
p.add_argument("--darner", required=True, type=Path, help="a darner checkout")
p.add_argument("--dejima", required=True, type=Path, help="a dejima checkout")
ARGS = p.parse_args()
sys.path.insert(0, str(ARGS.darner.resolve()))

import darner  # noqa: E402
from aiohttp.test_utils import TestClient, TestServer  # noqa: E402
from darner import api, configsets, job, launch  # noqa: E402
from darner.web import SETTING_LABELS  # noqa: E402
from darner.web import make_app as make_web  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
FIXTURES = ROOT / "test" / "fixtures"
ORIGIN = "https://darner-demo.dejima.page"
HOST = {"Host": "darner-demo.dejima.page"}
POST = {**HOST, "Origin": ORIGIN, "X-Darner-Request": "1", "Sec-Fetch-Site": "same-origin"}
TOKEN = "darner-demo-" + "0" * 32
# Every session's id and name in a captured page is one of these, which demo.js
# replaces with the visitor's.
ID, NAME = "dn-zzzzz", "example"
# dejima's defaults and the operator's models, as a real setup would configure them.
DEJIMA_CONFIG = """\
[core]
harness = claude-code

[harness.claude-code]
backend = anthropic
model = claude-opus-5-5

[harness.cline]
backend = self-hosted
model = qwen3.5-4b
context_window = 120000
"""
CATALOG = {
    "claude-code": {"anthropic": {"models": ["claude-opus-5-5", "claude-sonnet-5-5"]}},
    "cline": {"self-hosted": {"models": [{"id": "qwen3.5-4b", "context_window": 120000}]},
              "openrouter": {"models": ["z-ai/glm-5.3"]}},
}
OUTPUT = """\
This is a demo of darner, and there's no model on the other end. No sandbox was started, and nothing you typed left your browser.

On a real darner, your task would now be running as an isolated [dejima](https://dejima.page) session on the dejima host, with the settings you chose. Its page would show its output once the agent wrote `~/shared/RESULT.md` and signalled it was done, with everything else it left in `~/shared` as a zip. Until then, you could send it a message, upload a file into its `~/shared/uploads`, and allow or deny the domains it asks for.

This output came the way a real session's does: from the stub launcher this demo was built with, through darner's API, cleaned and shown as text written by an agent, which is why it's labelled as the agent's. **Self-test** sends text written like a hostile agent's down the same path, to show what this page does with it.
"""
STUB = r'''
import json, os, sys
ctl = json.load(open(os.environ["DEMO_STUB"]))
cmd = sys.argv[1:]
if cmd == ["status"]:
    print(json.dumps(ctl["status"]))
elif cmd[:1] == ["catalog"]:
    print(json.dumps(ctl["catalog"]))
elif cmd[:1] == ["fetch"]:
    sys.stdout.buffer.write(open(ctl["fetch"], "rb").read())
elif cmd[:1] == ["forget-delivered"]:
    print(json.dumps({"pruned": True}))
elif cmd[:1] == ["forget"]:
    print(json.dumps({"kept": "its output wasn't delivered whole"}))
elif cmd[:1] in (["stop"], ["discard"]):
    pass
elif not cmd:
    job = json.load(sys.stdin)
    print(json.dumps({"id": job["id"], "target": "darner:" + job["id"]}))
else:
    # A command darner added since this stub was written: say so, rather than guess.
    sys.exit(f"the generator's stub launcher doesn't know {cmd}; teach it what darner-launch answers")
'''


def dejima_catalog(dejima: Path, home: Path) -> dict:
    """darner-launch's catalog of this dejima, under a home holding DEJIMA_CONFIG."""
    (home / ".config" / "dejima").mkdir(parents=True)
    (home / ".config" / "dejima" / "config").write_text(DEJIMA_CONFIG)
    saved = os.environ.get("HOME")
    os.environ["HOME"] = str(home)
    try:
        args = launch.parse_args(["--dejima", str(dejima / "bin" / "dejima"), "--dejima-share", str(dejima / "bin" / "dejima-share")])
        with contextlib.redirect_stderr(io.StringIO()):
            return launch.catalog(args)
    finally:
        os.environ["HOME"] = saved


def git(path: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(path), *args], capture_output=True, text=True, check=True).stdout.strip()


def output_zip(path: Path) -> None:
    with zipfile.ZipFile(path, "w") as zf:
        info = zipfile.ZipInfo("RESULT.md")
        info.external_attr = 0o100644 << 16
        zf.writestr(info, OUTPUT)


class Demo:
    def __init__(self, work: Path, dejima: Path):
        self.work = work
        self.ctl = work / "stub.json"
        self.state = {"status": [], "fetch": str(work / "out.zip"), "catalog": dejima_catalog(dejima, work / "home")}
        self.save()
        (work / "stub.py").write_text(STUB)
        os.environ["DEMO_STUB"] = str(self.ctl)
        blurbs = work / "blurbs"
        shutil.copytree(ROOT / "blurbs", blurbs, dirs_exist_ok=True)
        shutil.copytree(ROOT / "configs", work / "configs")
        shutil.copytree(ROOT / "files", work / "configs" / "files")
        self.config = {
            "db_path": str(work / "db"), "results_dir": str(work / "results"),
            "blurbs_dir": str(blurbs), "configs_dir": str(work / "configs"),
            "tokens": {"web": TOKEN}, "launch_command": [sys.executable, str(work / "stub.py")],
            "catalog": CATALOG, "policy": {},
        }
        output_zip(work / "out.zip")

    def save(self):
        self.ctl.write_text(json.dumps(self.state))

    def status(self, **tasks):
        """Each task's state as the launcher reports it: running, ready (with output) or exited."""
        self.state["status"] = [
            {"id": tid, "state": "exited" if s == "exited" else "running", "ready": s == "ready", "help": False, "answerable": False}
            for tid, s in tasks.items()
        ]
        self.save()

    async def __aenter__(self):
        self.api_app = api.make_app(api.with_defaults(self.config)[0], poll=False)
        self.api = TestServer(self.api_app)
        await self.api.start_server()
        web = make_web({"api_url": str(self.api.make_url("")), "api_token": TOKEN, "public_origin": ORIGIN})
        self.web = TestClient(TestServer(web))
        await self.web.start_server()
        return self

    async def __aexit__(self, *exc):
        await self.web.close()
        await self.api.close()

    async def get(self, path: str, status: int = 200) -> str:
        resp = await self.web.get(path, headers=HOST)
        assert resp.status == status, (path, resp.status, await resp.text())
        return await resp.text()

    async def post(self, path: str, body: dict) -> tuple[int, dict]:
        resp = await self.web.post(path, json=body, headers=POST)
        return resp.status, await resp.json()

    async def start(self, **form) -> str:
        status, body = await self.post("/tasks", {"ref": os.urandom(16).hex(), **form})
        assert status == 200, body
        return body["location"].rsplit("/", 1)[1]

    async def poll(self):
        await api.poll_once(self.api_app)


def main_of(html: str) -> str:
    m = re.fullmatch(r"(?s)(.*<main>\n)(.*)(</main>.*)", html)
    assert m, "no <main> in a page"
    return m[2]


def views(base: str, variants: dict[str, str]) -> str:
    """One page holding each variant's <main>, for demo.js to keep the visitor's and drop the rest."""
    parts = [f'<div data-view="{name}">\n{main_of(html)}</div>\n' for name, html in variants.items()]
    return re.sub(r"(?s)(<main>\n).*(</main>)", lambda m: m[1] + "".join(parts) + m[2], base)


def finish(html: str, data: str) -> str:
    """A captured page as the demo serves it: demo.js before app.js, its styles, and the note saying what it is."""
    for old, new in (
        ('<script src="/static/app.js" defer></script>',
         f'<script type="application/json" id="demo-data">{data}</script>\n'
         '<script type="module" src="/demo/demo.js"></script>\n<script src="/static/app.js" defer></script>'),
        ('<link rel="stylesheet" href="/static/app.css">',
         '<link rel="stylesheet" href="/static/app.css">\n<link rel="stylesheet" href="/demo/demo.css">'),
        ("</header>\n",
         '</header>\n<p class="demo-note">A demo of darner, with no model and no sandbox: nothing you type leaves this browser. '
         '<a href="https://dejima.page/">dejima.page</a></p>\n'),
    ):
        assert html.count(old) == 1, old
        html = html.replace(old, new)
    return html


def combos(names: list[str]):
    for n in range(len(names) + 1):
        yield from itertools.combinations(names, n)


def config_sets(configs_dir: Path) -> dict:
    """What each combination of config sets gives a task, as the API's _build combines them,
    with the single values they disagree on in the order the API refuses them."""
    names = configsets.available(configs_dir)
    result = {}
    for combo in combos(names):
        sets = configsets.load(configs_dir, list(combo), overridden=configsets.SINGLES)
        order = []
        for name in combo:
            found = configsets.parse(name, (configs_dir / name).read_text())
            order += [k for k in configsets.SINGLES if found[k] is not None and k not in order]
        conflicts = []
        for key in order:
            try:
                configsets.load(configs_dir, list(combo), overridden=set(configsets.SINGLES) - {key})
            except configsets.ConfigSetError as e:
                conflicts.append([key, str(e)])
        result[",".join(combo)] = {"sets": sets, "conflicts": conflicts}
    return result


# Bodies the node tests send to demo.js's preview and to darner's, which must answer alike.
SAMPLES = [
    {},
    {"configs": ["recipe-service"]},
    {"configs": ["local", "sealed"], "blurbs": ["recipe-service"]},
    {"configs": ["local"], "harness": "claude-code"},
    {"harness": "claude-code", "backend": "openrouter"},
    {"harness": "claude-code", "effort": "none"},
    {"harness": "claude-code", "context_window": "50000"},
    {"harness": "cline", "context_window": "lots"},
    {"harness": "cline", "context_window": "100"},
    {"domains": "pypi.org, Files.PythonHosted.org", "internal": "git.example.com:2222", "dependencies": "apt:jq pip:pytest"},
    {"domains": "not_a_domain"},
    {"dependencies": "brew:jq"},
    {"dependencies": "tarball:tool@" + "0" * 64 + ":https://example.com/tool.tgz"},
    {"internal": "intranet"},
    {"name": "my-session"},
    {"name": "dn-abcde"},
    {"name": "Has Spaces"},
    {"network": "sealed", "configs": ["recipe-service"], "blurbs": ["search"], "model": "qwen3.5-4b"},
    {"model": "bad model"},
    {"effort": "high", "harness": "cline", "backend": "self-hosted"},
]


async def generate(dejima: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        demo = Demo(work, dejima)
        async with demo:
            pages = {}
            pages["sessions-empty"] = await demo.get("/")
            pages["new"] = await demo.get("/new")
            pages["blurbs"] = await demo.get("/blurbs")
            pages["configs"] = await demo.get("/configs")
            pages["selftest"] = await demo.get("/selftest")
            blurb_names = sorted(f.stem for f in (ROOT / "blurbs").glob("*.md"))
            config_names = configsets.available(work / "configs")
            for name in blurb_names:
                pages[f"blurbs/{name}"] = await demo.get(f"/blurbs/{name}")
            for name in config_names:
                pages[f"configs/{name}"] = await demo.get(f"/configs/{name}")

            previews = []
            for body in SAMPLES:
                status, answer = await demo.post("/tasks/preview", {"task": "", **body})
                previews.append({"body": body, "status": status, "answer": answer})

            # A named task with every setting, running with nothing yet, then with its output.
            form = {
                "task": "Add the recipe at https://recipes.example.org/banana-bread", "name": NAME,
                "configs": ["recipe-service"], "blurbs": ["search"], "domains": "pypi.org", "internal": "",
                "dependencies": "pip:requests", "network": "", "harness": "", "backend": "", "model": "",
                "effort": "high", "context_window": "",
            }
            task = await demo.start(**form)
            demo.status(**{task: "running"})
            pages["running"] = await demo.get(f"/sessions/{task}")
            demo.status(**{task: "ready"})
            await demo.poll()
            demo.status(**{task: "running"})
            pages["running-output"] = await demo.get(f"/sessions/{task}")
            seq = re.search(rf'/sessions/{task}/outputs/(\d+)\.zip', pages["running-output"])[1]
            resp = await demo.web.get(f"/sessions/{task}/outputs/{seq}.zip", headers=HOST)
            zip_data = await resp.read()

            # One stopped before it delivered anything.
            other = await demo.start(task="Look at it later")
            demo.status(**{task: "running", other: "exited"})
            await demo.poll()
            pages["ended"] = await demo.get(f"/sessions/{other}")
            pages["sessions-list"] = await demo.get("/")

            demo.status(**{task: "exited"})
            status, body = await demo.post(f"/sessions/{task}/stop", {})
            assert status == 200, body
            pages["ended-output"] = await demo.get(f"/sessions/{task}")

            status, body = await demo.post("/selftest", {})
            selftest = body["location"].rsplit("/", 1)[1]
            pages["selftest-session"] = await demo.get(f"/sessions/{selftest}")
            pages["gone"] = await demo.get(f"/sessions/{ID}", status=404)
            sets = config_sets(work / "configs")

    for key, html in pages.items():
        for real in (task, other, selftest):
            html = html.replace(real, ID)
        assert not re.search(r"dn-(?!zzzzz\b|example\b|k3x7q\b)[a-z2-7]{5}\b", html), f"{key} names another session"
        # Both differ on every capture, and demo.js sets its own.
        html = re.sub(r'data-version="[0-9a-f]+"', 'data-version="captured"', html)
        html = re.sub(r'name="ref" value="[0-9a-f]{32}"', 'name="ref" value="' + "0" * 32 + '"', html)
        pages[key] = html

    data = {
        "id": ID, "name": NAME,
        "labels": SETTING_LABELS, "started_with": list(api.STARTED_WITH), "singles": list(configsets.SINGLES),
        "sets": sets, "blurbs": {n: (ROOT / "blurbs" / f"{n}.md").read_text() for n in blurb_names},
        "session_name": api.SESSION_NAME.pattern, "name_rule": api.NAME_RULE,
        "domain": job._DOMAIN.pattern, "dependency": job._DEP.pattern, "tarball": job._TARBALL.pattern,
        "effort": job._EFFORT.pattern, "context_window": [job.CONTEXT_WINDOW.start, job.CONTEXT_WINDOW.stop - 1],
        "networks": list(job.NETWORKS), "max_grants": job.MAX_GRANTS,
        "dependency_kinds": list(api.DEFAULT_DEPENDENCY_KINDS),
        "catalog": demo.state["catalog"],
    }
    # Kept out of a <script> element's end tag, however the data reads.
    inline = json.dumps(data, separators=(",", ":")).replace("<", "\\u003c")

    if SITE.exists():
        shutil.rmtree(SITE)
    (SITE / "sessions").mkdir(parents=True)
    (SITE / "blurbs").mkdir()
    (SITE / "configs").mkdir()
    shutil.copytree(Path(darner.__file__).parent / "web" / "static", SITE / "static")
    out = {
        "index.html": views(pages["sessions-empty"], {"empty": pages["sessions-empty"], "list": pages["sessions-list"]}),
        "sessions/view.html": views(pages["running"], {
            v: pages[v] for v in ("running", "running-output", "ended", "ended-output", "selftest-session", "gone")
        }),
        "new.html": pages["new"], "blurbs.html": pages["blurbs"], "configs.html": pages["configs"],
        "selftest.html": pages["selftest"],
        **{f"{k}.html": v for k, v in pages.items() if k.startswith(("blurbs/", "configs/"))},
    }
    for path, html in out.items():
        (SITE / path).write_text(finish(html, inline))
    (SITE / "demo").mkdir()
    (SITE / "demo" / "output.zip").write_bytes(zip_data)

    FIXTURES.mkdir(parents=True, exist_ok=True)
    (FIXTURES / "previews.json").write_text(json.dumps({"data": data, "previews": previews}, indent=1) + "\n")
    darner_root = Path(darner.__file__).parent.parent
    sources = {
        "darner": {"repo": "dejima/darner", **pin(darner_root), "version": darner_version(darner_root)},
        "dejima": {"repo": "dejima/dejima", **pin(dejima)},
    }
    (ROOT / "sources.json").write_text(json.dumps(sources, indent=2) + "\n")
    shown = {k: v["release"] or f"{v['ref']} at {v['commit'][:7]}" for k, v in sources.items()}
    print(f"generated site/ from darner {shown['darner']} and dejima {shown['dejima']}")


def pin(checkout: Path) -> dict:
    """What a checkout is at: its release tag, or else its branch, with the commit and today's date."""
    # Releases only, as make sources counts them: not darner's v<version>.dev<run> pre-releases.
    tags = git(checkout, "tag", "--points-at", "HEAD").split()
    release = next((t for t in tags if re.fullmatch(r"v?\d+(\.\d+)+[a-z]?", t)), None)
    return {
        "release": release, "ref": None if release else git(checkout, "rev-parse", "--abbrev-ref", "HEAD"),
        "commit": git(checkout, "rev-parse", "HEAD"), "captured": datetime.date.today().isoformat(),
    }


def darner_version(root: Path) -> str:
    return re.search(r'^version = "(.*)"', (root / "pyproject.toml").read_text(), re.M)[1]


if __name__ == "__main__":
    asyncio.run(generate(ARGS.dejima.resolve()))

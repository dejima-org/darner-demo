# Keeping the demo current

The demo shows darner-web as it is, and claims to check a task as darner does. A page captured from an old darner, or a check that has drifted from the API's, is a defect, not a rough edge. This is how it stays matched to darner and dejima without re-reading either every time one changes.

`sources.json` records what the pages were captured from: a release for darner and for dejima, or a branch and commit where the demo runs ahead of a release. `tools/generate.py` writes it on each capture. The demo follows releases on `main`, not `development`: `development` moves daily, and what an operator runs is a release.

## When to update

- **A darner release**, which ships in lockstep with a dejima release: always, from both releases' tags.
- **A dejima release** without a darner release: always too. The catalog, the harnesses, backends, effort levels and context windows the form offers, comes from dejima's manifests.
- **Between releases**, only to show a darner change before it's released, as the demo did for darner #89. Pin back to releases at the next one.

`make sources` says which pins have fallen behind. It needs read access to the forge; `DARNER_DEMO_FORGE=git@<forge>:` points it at an SSH remote instead of the public HTTPS one.

## 1. Capture

Every page is captured from darner, so this step is mechanical and always runs. Check out both releases, with darner's test dependencies in its `.venv` as its `docs/development.md` describes, then:

```sh
make generate DARNER=<darner checkout> DEJIMA=<dejima checkout>
make test
make build && node test/browser.mjs
```

- **The generator stops** if darner's API asks the stub launcher for a command it doesn't know, or a session state no longer captures as expected. Teach the stub what darner-launch answers, or the generator what the page now shows.
- **`make test` fails** when `src/model.js` no longer answers the new-task form as darner's API does: a check, its order or its message changed. Match `src/model.js` to darner.
- **`node test/browser.mjs` fails** when darner-web changed something `src/demo.js` relies on: the views it keeps, the placeholders it replaces, or a request `app.js` makes. Match `src/demo.js` to darner-web.

`git diff site/` then shows what changed for a visitor.

## 2. Triage

What the tests can't catch is a change they don't exercise. Read darner's and dejima's changelog entries between the pinned releases and the new ones. For each entry, ask whether it changes something the demo answers for darner, or says about it:

- **a new-task check** (`src/model.js`, mirroring darner-api's `_build`, `validate_job`, `check_policy`, `_session_name`, `_name_taken` and `check_job_harness`, and `configsets.load`): give it a sample in `SAMPLES` in `tools/generate.py`, so `make test` holds it to darner's answer;
- **a request darner-web's `app.js` makes**: `src/demo.js` answers each one, and anything else as "The demo doesn't do that";
- **a session state or event** the session page shows: a new view in the generator, and in `view()` in `src/model.js`;
- **the stub launcher's answers**: what `status`, `fetch`, `forget` and `forget-delivered` say, which decide what the pages show about output and `~/shared`;
- **what the demo says about darner**: the demo output (`OUTPUT` in the generator), the note on every page, and the README;
- **dejima's defaults and the operator's models**, which the generator sets to example values (`DEJIMA_CONFIG` and `CATALOG`): a renamed harness, backend or setting.

## 3. Check it and commit

Look at it in a browser, on a phone too: start a task with each config set, watch its output arrive, message, stop and clear it, and run the self-test.

Commit `site/`, `test/fixtures/`, `sources.json` and any change to `src/` or the generator together, so the pin always names what the pages are. List the changelog entries reviewed in the commit message, so the next person can see the releases were read and not skipped.

## 4. Tag it

After the change merges, tag `main` with the dejima release it reflects, as `dejima-<release>` (for example `dejima-2026.11.04`), as dejima-xray does. The demo as it was for any dejima release can then be found, even after it has moved on.

## What the demo assumes

- There's no `[policy]` in its API, so only darner's default dependency kinds limit a task, and `src/model.js` checks nothing more.
- dejima's defaults and the operator's models are the example values in the generator, and the files a config set gives a session are the placeholders in `files/`.
- Sessions live in the visitor's browser, and its output arrives after `OUTPUT_AFTER` seconds, set in `src/model.js`.

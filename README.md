# darner-demo

A demo of [darner](https://gitbox.branderson.io/dejima/darner)'s browser frontend, darner-web, as a static site. Start a task with the example config sets and blurbs, watch its session run and deliver output, message it, stop it and clear it, or run the self-test. There's no model and no sandbox behind it: the visitor's sessions live in their browser's localStorage, and nothing they type is sent anywhere.

## Preview

```sh
make serve
```

Then open `http://localhost:8000`. `make check` builds `public/` and fails if anything a page references is missing. `make test` runs the model's tests.

## How it is put together

Every page is one darner-web served. `tools/generate.py` runs darner's own API and darner-web in-process, with a stub in place of the launcher on the dejima host, and captures what they serve:

- **The catalog** is darner-launch's, read from a dejima checkout's manifests, with dejima's defaults and the operator's models set to example values in the script.
- **The config sets and blurbs** are `configs/` and `blurbs/`, as darner reads them from `configs_dir` and `blurbs_dir`: a blurb is `<name>.md`. The files a config set gives a session are placeholders in `files/`.
- **The demo task** is started through darner-web's form and the API's launch. Its output, `OUTPUT` in the script, is delivered from the stub as a zip, the way a real session's is. It's then stopped through the API.

The pages go into `site/`, with darner-web's own `static/`. Each session state is captured as its own view: running with nothing yet, running with output, ended with and without output, the self-test's session, and a session that doesn't exist. The view for every state shares one page, `site/sessions/view.html`.

`src/demo.js` runs before darner-web's own `app.js`. It plays darner-web and the API for that script:
- It answers the requests `app.js` makes.
- It keeps the view that fits the visitor's session.
- It puts the session's id, name, age and settings in place of the captured ones.

Like `app.js`, it sets text and never inserts HTML, so darner-web's CSP holds unchanged.

`src/model.js` is what it answers with: the new-task form's preview and start, checked as darner-api checks them. The rules and messages come from darner, through the data the generator embeds in each page. `test/model.test.mjs` holds the preview to darner's own answers for the same forms, captured in `test/fixtures/previews.json`. `test/browser.mjs` runs a whole visit in Chromium against `make build`, served as nginx serves it (`tools/serve.py`). It needs Playwright, so it isn't run in CI.

## Keeping it current

`sources.json` says which darner and dejima the pages were captured from. After a darner or dejima release, or a change to `configs/`, `blurbs/` or the generator:

```sh
make generate DARNER=<darner checkout> DEJIMA=<dejima checkout>
make test
make build && node test/browser.mjs
```

The darner checkout needs its test dependencies in `.venv`, as its `docs/development.md` describes. If darner changed what its preview checks, `make test` fails until `src/model.js` matches.

## Licence

GPL-3.0-or-later, as darner, whose templates, script and styles the pages are. `site/static/` is darner-web's: its README says what is and isn't covered.

## Deploy

Served at `darner-demo.dejima.page`, from the same web host as `dejima.page` and `xray.dejima.page`, and the same way:

```
forge (Gitea), on every push to main
  └─ .gitea/workflows/deploy.yml, on a dejima-confined runner
       1. make check test   build public/, check it, run the tests
       2. upload public/ as the run's `site` artifact

web host, every 5 minutes (deploy/dejima-darner-demo-pull.timer)
  └─ deploy/pull-site.sh
       1. find the newest successful deploy.yml run for a push to main;
          stop if its commit is already live
       2. download its `site` artifact, unpack it into releases/<commit>/,
          refuse it without an index.html
       3. atomically repoint the `current` symlink at it
       4. keep the newest 5 releases

nginx  root = /srv/www/darner-demo.dejima.page/current  (deploy/nginx.conf)
```

The web host pulls rather than CI pushing, because the runner executes agent-authored code and is kept off the network the web host sits on. CI talks only to the forge; the web host talks only to the forge, read-only. Neither holds a credential for the other, and the artifact upload uses the run's own token.

Only a successful run of `deploy.yml` for a push to `main` is deployable: the forge records a run's branch and event, so a workflow on another branch can't produce a build the host will take. Keep `main` protected. A failed download, a wrong token, or an artifact without `index.html` leaves the live release in place.

### Setting it up

This reuses what the landing page's deploy already created: the `site-deploy` forge account and its token, and the `site-deploy` user and `/etc/site-deploy/token` on the web host.

**Forge, once.** Add `site-deploy` to this repository as a collaborator with **read** access. No new token, and no Actions secret.

**Web host, once.**

```sh
install -d -o site-deploy -g site-deploy -m 755 /srv/www/darner-demo.dejima.page

# Fetch just deploy/. --config-env keeps the token out of argv and out of the
# clone's .git/config. Needs git 2.31+.
export GIT_AUTH="Authorization: token $(cat /etc/site-deploy/token)"
git --config-env=http.extraHeader=GIT_AUTH clone --depth 1 --filter=blob:none --sparse \
    https://gitbox.branderson.io/dejima/darner-demo.git /usr/local/src/dejima-darner-demo
git --config-env=http.extraHeader=GIT_AUTH -C /usr/local/src/dejima-darner-demo sparse-checkout set deploy
unset GIT_AUTH
cd /usr/local/src/dejima-darner-demo

install -m 755 deploy/pull-site.sh /usr/local/bin/pull-dejima-darner-demo.sh
install -m 644 deploy/dejima-darner-demo-pull.service deploy/dejima-darner-demo-pull.timer /etc/systemd/system/
systemctl daemon-reload
systemctl start dejima-darner-demo-pull.service      # first deploy, now; check it worked:
journalctl -u dejima-darner-demo-pull.service -n 20
systemctl enable --now dejima-darner-demo-pull.timer
```

The script and units have their own names, so they sit beside the landing page's and xray's without touching them. `SITE_FORGE_API` in the service names the forge by its public hostname; if the web host reaches it by another name, override it with `systemctl edit dejima-darner-demo-pull.service` rather than editing the committed file.

Add the directives in `deploy/nginx.conf` to a new `darner-demo.dejima.page` server block inside the host's existing TLS setup, with a certificate for `darner-demo.dejima.page` or `*.dejima.page`, then `nginx -t && systemctl reload nginx`. The `current` symlink is resolved per request, so later deploys need no reload.

`deploy/nginx.conf` sends darner-web's own headers, its CSP included, and maps every session's page to `sessions/view.html` and every session's zip to the demo's. An `add_header` in a `location` block replaces the server block's, so none of its locations add one; keep it that way if you add any.

`pull-site.sh` needs bash, curl, jq, unzip, and coreutils.

To pick up a later change to `deploy/`, update the clone and repeat the two `install` lines and `systemctl daemon-reload`:

```sh
export GIT_AUTH="Authorization: token $(cat /etc/site-deploy/token)"
git --config-env=http.extraHeader=GIT_AUTH -C /usr/local/src/dejima-darner-demo pull --depth 1
unset GIT_AUTH
```

### Checking a deploy

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://darner-demo.dejima.page/
curl -s -o /dev/null -w "%{http_code}\n" https://darner-demo.dejima.page/sessions/dn-abcde
curl -sI https://darner-demo.dejima.page/ | grep -i content-security-policy
```

The first two print 200, and the third prints darner-web's CSP. `readlink /srv/www/darner-demo.dejima.page/current` on the host names the commit being served. Then start a task in a browser, on a phone too.

### Rollback

Releases are kept in `releases/`, each named after the first 12 characters of its commit. To serve an earlier one:

```sh
systemctl stop dejima-darner-demo-pull.timer   # or the next run redeploys main
cd /srv/www/darner-demo.dejima.page
ls -1t releases                                # pick the release to restore
sudo -u site-deploy sh -c 'ln -sfn releases/<id> current.new && mv -T current.new current'
```

That changes what is served, not what is on `main`. Fix or revert the commit on the forge, let CI publish the fix, then `systemctl start dejima-darner-demo-pull.timer` again.

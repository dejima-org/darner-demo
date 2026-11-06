# site/ is what tools/generate.py captured from darner; src/ is the demo's own
# script and styles. Both go into public/, which is what gets published.
DARNER ?= ../darner
DEJIMA ?= ../dejima

.PHONY: build check test serve generate sources clean

build:
	rm -rf public
	cp -R site public
	mkdir -p public/demo
	cp src/demo.js src/model.js src/demo.css public/demo/

# Every local file a page references has to be in the build, and each font's licence.
check: build
	@missing=0; \
	for page in $$(find public -name '*.html'); do \
		for ref in $$(grep -oE '(src|href)="/[^"#?]*"' "$$page" | sed -E 's/^(src|href)="\///; s/"$$//'); do \
			case "$$ref" in sessions/*) continue ;; esac; \
			[ -e "public/$$ref" ] || [ -e "public/$$ref.html" ] || [ "$$ref" = "" ] || { echo "$$page: missing from the build: /$$ref"; missing=1; }; \
		done; \
	done; \
	for font in jost ibm-plex-serif jetbrains-mono; do \
		[ -e "public/static/fonts/LICENSE-$$font.txt" ] || { echo "missing from the build: the licence for $$font, which the OFL asks to travel with it"; missing=1; }; \
	done; \
	exit $$missing

test:
	node --test test/*.test.mjs

# Regenerates site/ and test/fixtures/ from a darner and a dejima checkout.
generate:
	$(DARNER)/.venv/bin/python tools/generate.py --darner $(DARNER) --dejima $(DEJIMA)

# Which pins in sources.json have fallen behind their projects. Needs read
# access to the forge; DARNER_DEMO_FORGE overrides where it reads from.
sources:
	node tools/check-sources.mjs

serve: build
	python3 tools/serve.py public 8000

clean:
	rm -rf public

# site/ is what tools/generate.py captured from darner; src/ is the demo's own
# script and styles. Both go into public/, which is what gets published.
DARNER ?= ../darner
DEJIMA ?= ../dejima

.PHONY: build check test serve generate clean

build:
	rm -rf public
	cp -R site public
	mkdir -p public/demo
	cp src/demo.js src/model.js src/demo.css public/demo/

# Every local file a page references has to be in the build.
check: build
	@missing=0; \
	for page in $$(find public -name '*.html'); do \
		for ref in $$(grep -oE '(src|href)="/[^"#?]*"' "$$page" | sed -E 's/^(src|href)="\///; s/"$$//'); do \
			case "$$ref" in sessions/*) continue ;; esac; \
			[ -e "public/$$ref" ] || [ -e "public/$$ref.html" ] || [ "$$ref" = "" ] || { echo "$$page: missing from the build: /$$ref"; missing=1; }; \
		done; \
	done; \
	exit $$missing

test:
	node --test test/*.test.mjs

# Regenerates site/ and test/fixtures/ from a darner and a dejima checkout.
generate:
	$(DARNER)/.venv/bin/python tools/generate.py --darner $(DARNER) --dejima $(DEJIMA)

serve: build
	python3 tools/serve.py public 8000

clean:
	rm -rf public

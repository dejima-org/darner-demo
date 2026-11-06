- Server: `https://recipes.example.com:8443` (recipe-service v1.1). **Port 8443, not 443**: port 443 times out.
- Auth: `Authorization: Bearer <token>`. The token is in the `recipe-service-api-token` file at `/home/user/shared/uploads/recipe-service-api-token`. Never print it or commit it.
- To add a recipe from a URL, use `add_recipe.py URL` (`--dry-run` first) in `/home/user/shared/uploads/add_recipe.py`. It checks for duplicates, imports, and parses ingredients, matching them to existing foods and units.
    - You can use this as an example to build off if doing something else on the server.
- If the expected filea aren't in `/home/user/shared/uploads`, stop and tell the user.
- Recipe page: `https://recipes.example.com:8443/g/home/r/<slug>`
- When adding or modifying recipes in the server, remember to parse the ingredients and amounts into recipe-service's internal objects, rather than raw strings. Use existing ingredients and amounts in the recipe-service instance where possible, rather than creating new ones.

API, if doing it by hand:
- The API docs are at https://recipes.example.com:8443/docs.
- Duplicate check: `GET /api/recipes?perPage=-1`, then compare `orgURL` with the source URL. `?search=` is fuzzy and unreliable.
- Import: `POST /api/recipes/create/url` with `{"url": ..., "includeTags": true}`. It returns the slug as a JSON string with quotes.
- Imported ingredients are raw text (`food: null`, with the text in `note`). They must be parsed afterwards.
- Parse: `POST /api/parser/ingredients` with `{"strategy": "nlp", "ingredients": [lines]}`.
  - A food or unit **without an `id`** is the parser proposing a new one. Map it to an existing item instead (`GET /api/foods?perPage=-1`, `GET /api/units?perPage=-1`). For example, "ripe bananas" becomes food `banana` with note `ripe`.
  - The parser sometimes drops words (e.g. "mini" in "mini chocolate chips") and rounds 1/3 to 0.333. Compare each result with the input line.
- Save: `PATCH /api/recipes/<slug>` with `{"recipeIngredient": [...]}`. Keep each item's `referenceId`, and set `originalText` to the source line.
- Verify: `GET /api/recipes/<slug>` and check each ingredient's `display`.
- Imports often leave `recipeYield` empty and add "Recipe by <site>" to the name. Fix these with a `PATCH` if wanted.


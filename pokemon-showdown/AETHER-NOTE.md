# Vendored Pokémon Showdown engine

This directory is a copy of the open-source
[smogon/pokemon-showdown](https://github.com/smogon/pokemon-showdown) battle engine
(MIT-licensed — see `LICENSE`). Only the parts needed to simulate battles are vendored:
`sim/` (the battle engine), `data/` (Pokédex, moves, items, abilities, learnsets, random-battle
generators), `lib/`, `config/`, and `tools/`. The multiplayer server, tests, and translations
are intentionally omitted.

## How it's used in AetherESports

The site is a **static export** (GitHub Pages), so there is no server at runtime — the battle
must run entirely in the browser. Showdown's raw `sim/dex.ts` loads data with Node's `fs` and
runtime-computed `require()`, which cannot be bundled for the browser. So the live Battle page
(`app/battle`) runs the **same engine** via [`@pkmn/sim`](https://github.com/pkmn/ps) +
[`@pkmn/randoms`](https://github.com/pkmn/ps) — Pokémon Showdown's simulator repackaged for
bundlers. Mechanics are identical to the games / play.pokemonshowdown.com.

This vendored copy is kept as the authoritative source of record and mechanics reference.

// The Pokémon Showdown engine (@pkmn/sim, @pkmn/randoms) references Node globals
// (`global`, occasionally `process`) that don't exist in the browser. Defining them as
// properties of `globalThis` makes those bare references resolve instead of throwing.
//
// This module MUST be imported before any @pkmn package so the shim runs first
// (ES module imports evaluate in order, before the importing module's body).

const g = globalThis as unknown as {
  global?: unknown;
  process?: { env: Record<string, string | undefined> };
};

if (typeof g.global === "undefined") {
  g.global = globalThis;
}

if (typeof g.process === "undefined") {
  g.process = { env: {} };
}

export {};

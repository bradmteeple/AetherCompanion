// Derives Blue's PlanData from a run (best selection, learned Red threats, how Blue's team
// wants to play). This pulls in the @pkmn dex/teams, so it's imported only from auto-engine.ts
// (itself dynamically imported) — keeping the engine out of the Auto Battle page's initial load.

import "./node-shim"; // must precede any @pkmn import
import { Dex, Teams, toID } from "@pkmn/sim";
import type { PlanData, PlanThreat } from "./game-plan";

type Book = Record<string, Record<string, number>>;

export interface AnalyzeArgs {
  blueTeamPacked: string;
  blueTeamName: string;
  redTeamName: string;
  blueWins: number;
  redWins: number;
  games: number;
  combos: { combo: string; games: number; wins: number }[]; // sorted best-first by win rate
  book: Book; // Blue's learned model of Red (species id -> move id -> count)
}

interface MonInfo {
  species: string; // display name
  spe: number;
  hasTR: boolean;
  hasTW: boolean;
  offense: number; // max(atk, spa) base stat
}

function unpackBlue(packed: string): MonInfo[] {
  const sets = Teams.unpack(packed) ?? [];
  return sets.map((s: any) => {
    const sp = Dex.species.get(s.species || s.name);
    const base = sp.baseStats ?? { atk: 0, spa: 0, spe: 0 };
    const moveIds = (s.moves ?? []).map((m: string) => toID(m));
    return {
      species: sp.name || s.species || s.name,
      spe: base.spe ?? 0,
      hasTR: moveIds.includes("trickroom"),
      hasTW: moveIds.includes("tailwind"),
      offense: Math.max(base.atk ?? 0, base.spa ?? 0),
    };
  });
}

// The strongest move (by base power) Blue saw a given Red species use.
function strongestSeenMove(book: Book, speciesId: string): { move: string; bp: number } | null {
  const moves = book[speciesId];
  if (!moves) return null;
  let bestMv = "";
  let bestCount = 0;
  for (const [mv, c] of Object.entries(moves)) if (c > bestCount) ((bestCount = c), (bestMv = mv));
  if (!bestMv) return null;
  const m = Dex.moves.get(bestMv);
  return { move: m.name || bestMv, bp: m.basePower || 0 };
}

export function analyzeBluePlan(a: AnalyzeArgs): PlanData {
  const decided = a.blueWins + a.redWins;
  const winPct = decided ? Math.round((a.blueWins / decided) * 100) : 0;

  // Best selection: highest win rate among reasonably-sampled picks, else the most-played.
  const sampled = a.combos.filter((c) => c.games >= 20);
  const best = sampled[0] ?? a.combos.slice().sort((x, y) => y.games - x.games)[0] ?? null;
  const selection = best ? best.combo.split(" + ") : [];
  const selectionWinPct = best && best.games ? Math.round((best.wins / best.games) * 100) : 0;
  const selectionGames = best ? best.games : 0;

  // Blue team shape + which of the brought four (fallback: whole team) to build the lead from.
  const team = unpackBlue(a.blueTeamPacked);
  const selSet = new Set(selection.map((n) => toID(n)));
  const brought = team.filter((m) => selSet.has(toID(m.species)));
  const pool = brought.length >= 2 ? brought : team;

  const trSetter = pool.find((m) => m.hasTR);
  const twSetter = pool.find((m) => m.hasTW);
  const archetype: PlanData["archetype"] = trSetter ? "Trick Room" : twSetter ? "Tailwind" : "Tempo";

  let lead: PlanData["lead"];
  if (trSetter) {
    const partner = pool
      .filter((m) => m.species !== trSetter.species)
      .sort((x, y) => y.offense - x.offense || x.spe - y.spe)[0];
    lead = {
      mons: [trSetter.species, partner?.species].filter(Boolean) as string[],
      reason: "Set Trick Room turn 1, then let your slow, hard hitters move first and clean up.",
    };
  } else if (twSetter) {
    const partner = pool
      .filter((m) => m.species !== twSetter.species)
      .sort((x, y) => y.offense - x.offense)[0];
    lead = {
      mons: [twSetter.species, partner?.species].filter(Boolean) as string[],
      reason: "Set Tailwind turn 1 to out-speed the field, then apply pressure while it lasts.",
    };
  } else {
    const two = pool.slice().sort((x, y) => y.offense - x.offense || y.spe - x.spe).slice(0, 2);
    lead = {
      mons: two.map((m) => m.species),
      reason: "Lead your two strongest attackers and trade efficiently, keeping momentum.",
    };
  }

  // Red's biggest learned threats (Blue prioritizes KO-ing these).
  const threats: PlanThreat[] = Object.keys(a.book)
    .map((id) => {
      const seen = strongestSeenMove(a.book, id);
      const sp = Dex.species.get(id);
      return { species: sp.name || id, move: seen?.move || "", bp: seen?.bp || 0 };
    })
    .filter((t) => t.bp > 0)
    .sort((x, y) => y.bp - x.bp)
    .slice(0, 3)
    .map((t) => ({ species: t.species, move: t.move }));

  return {
    blueTeam: a.blueTeamName,
    redTeam: a.redTeamName,
    games: a.games,
    blueWins: a.blueWins,
    redWins: a.redWins,
    winPct,
    archetype,
    selection,
    selectionWinPct,
    selectionGames,
    lead,
    threats,
  };
}

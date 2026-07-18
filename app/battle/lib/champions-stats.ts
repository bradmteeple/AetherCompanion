// Pokémon Champions (VGC 2026 Reg M-B) stat formula.
//
// Champions redefines training: each EV is worth exactly +1 to that stat, with no IV term
// and no level scaling. A Pokémon has 66 EV points total (enforced via "EV Limit = 66" in the
// format) and at most 32 in any single stat (clamped below). This mirrors the vendored Champions
// mod's statModify default (level-50) branch (pokemon-showdown/data/mods/champions/scripts.ts):
//   HP:      stat = base + ev + 75
//   others:  stat = base + ev + 20, then nature ±10% (16-bit truncated, exactly as Gen 9)
//
// We install this by wrapping @pkmn/sim's Battle.prototype.statModify — the single seam every
// stat flows through (spreadModify -> storedStats/maxhp, and from there damage, speed order, and
// the hover stat tooltip). The override is scoped to Reg M-B ONLY; all other formats (VGC 2025
// Reg I, Gen 9 Random Battle) fall through to the original Gen 9 calculation untouched.

import "./node-shim"; // must precede any @pkmn import
import { Battle } from "@pkmn/sim";

// Reg M-B is the only format whose custom rules hard-ban the Restricted Legendary tag
// (see engineFormat in formats.ts: "gen9vgc2025regi@@@!Limit Two Restricted,-Restricted Legendary").
// Reg I and Random Battle have customRules === null, so this uniquely identifies Champions.
function isChampionsBattle(battle: any): boolean {
  const rules = battle?.format?.customRules;
  return Array.isArray(rules) && rules.includes("-Restricted Legendary");
}

let installed = false;

export function installChampionsStats(): void {
  if (installed) return;
  installed = true;

  const proto = Battle.prototype as any;
  const original = proto.statModify;

  proto.statModify = function (baseStats: any, set: any, statName: string) {
    if (!isChampionsBattle(this)) return original.call(this, baseStats, set, statName);

    const tr = this.trunc.bind(this);
    const base = baseStats[statName];
    // Champions: 66 EV points per Pokémon (total enforced by "EV Limit = 66"), and a single
    // stat can hold at most 32 — clamp here so no stat ever gains more than +32.
    const ev = Math.min((set.evs && set.evs[statName]) || 0, 32);

    if (statName === "hp") return base + ev + 75;

    let stat = base + ev + 20;
    const nature = this.dex.natures.get(set.nature);
    if (nature.plus === statName) {
      stat = tr(tr(stat * 110, 16) / 100);
    } else if (nature.minus === statName) {
      stat = tr(tr(stat * 90, 16) / 100);
    }
    return stat;
  };
}

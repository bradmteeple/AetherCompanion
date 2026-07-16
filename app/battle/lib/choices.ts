// Helpers for assembling Pokémon Showdown choice strings for doubles.
// Target numbering (absolute, per Showdown): foe slot a = 1, foe slot b = 2;
// ally/self slots are negative: ally/self a = -1, b = -2.  See random-player-ai.ts.

import type { BoardState } from "./protocol";

export interface TargetOption {
  label: string;
  value: number;
}

const FOE_TARGETS = ["normal", "any", "adjacentFoe"];
const ALLY_TARGETS = ["any", "adjacentAlly", "adjacentAllyOrSelf"];

// Does this move require the player to pick a target in doubles?
export function needsTarget(target: string, doubles: boolean): boolean {
  if (!doubles) return false;
  return [...FOE_TARGETS, "adjacentAlly", "adjacentAllyOrSelf"].includes(target);
}

// Legal targets for a move, from the acting slot's point of view (player = p1).
export function targetOptions(target: string, slotIndex: number, board: BoardState): TargetOption[] {
  const opts: TargetOption[] = [];
  const other = slotIndex ^ 1;

  if (FOE_TARGETS.includes(target)) {
    board.p2.forEach((mon, fi) => {
      if (mon && !mon.fainted) opts.push({ label: `Foe ${mon.name}`, value: fi + 1 });
    });
  }
  if (ALLY_TARGETS.includes(target)) {
    const ally = board.p1[other];
    if (ally && !ally.fainted) opts.push({ label: `Ally ${ally.name}`, value: -(other + 1) });
  }
  if (target === "adjacentAllyOrSelf") {
    opts.push({ label: "Self", value: -(slotIndex + 1) });
  }
  return opts;
}

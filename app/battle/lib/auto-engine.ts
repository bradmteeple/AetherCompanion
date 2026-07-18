// Headless AI-vs-AI runner for the Auto Battle tab.
//
// Runs real Pokémon Showdown battles between two *random* players in the VGC 2026 Reg M-B
// format, back-to-back and as fast as the engine allows ("turbo"). Nothing is rendered
// per turn — the output is a running win/loss/tie tally plus, per side, how often each lead
// combination was brought. This is deliberately separate from the interactive Battle tab's
// BattleController (engine.ts), which drives a human on p1.
//
// Both sides are RandomPlayerAI subclasses (unseeded => a fresh random PRNG per game), and each
// game gets a fresh BattleStream (also unseeded), so no two games play out identically. The
// base RandomPlayerAI picks its Team Preview with "default" (always the same two leads), so we
// override chooseTeamPreview to bring a random selection — that's what makes the lead
// distribution meaningful.

import "./node-shim"; // must precede any @pkmn import — defines Node globals for the browser
import { BattleStreams, RandomPlayerAI } from "@pkmn/sim";
import { FORMATS } from "./formats";
import { installChampionsStats } from "./champions-stats";

installChampionsStats(); // Reg M-B (Champions): 1 EV = +1 stat; idempotent.

const TEAM_SIZE = FORMATS.vgcregmb.teamSize; // bring N (4 for Reg M-B)

export interface LeadCombo {
  combo: string; // "Torkoal + Hatterene" (the two Pokémon sorted, so order-independent)
  count: number;
}

export interface Tally {
  blue: number; // p1 wins
  red: number; // p2 wins
  ties: number;
  games: number;
  leadsBlue: LeadCombo[]; // Blue's lead pairs, most-used first
  leadsRed: LeadCombo[]; // Red's lead pairs, most-used first
}

export type GameResult = "blue" | "red" | "tie";

interface GameOutcome {
  result: GameResult;
  blueLead: string | null; // sorted "A + B" combo Blue led with, if captured
  redLead: string | null;
}

const P1_NAME = "Blue";
const P2_NAME = "Red";

// A random-play AI that also brings a RANDOM Team Preview selection (rather than the base
// class's fixed "default"), so leads vary game to game.
class LeadRandomAI extends RandomPlayerAI {
  protected override chooseTeamPreview(team: any[]): string {
    const n = team.length;
    const idx = Array.from({ length: n }, (_, i) => i + 1);
    // Fisher–Yates shuffle using the AI's own PRNG.
    for (let i = n - 1; i > 0; i--) {
      const j = this.prng.random(i + 1);
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const bring = Math.min(TEAM_SIZE, n);
    return "team " + idx.slice(0, bring).join("");
  }
}

// "p1a: Torkoal" -> { side: "p1", slot: 0 }; species comes from the details field instead.
function cleanName(details: string): string {
  return (details || "").split(",")[0].trim();
}

function comboKey(a: string | null, b: string | null): string | null {
  const both = [a, b].filter((x): x is string => !!x);
  if (both.length < 2) return null;
  return both.slice().sort().join(" + ");
}

function sortLeads(map: Map<string, number>): LeadCombo[] {
  return Array.from(map.entries())
    .map(([combo, count]) => ({ combo, count }))
    .sort((x, y) => y.count - x.count || x.combo.localeCompare(y.combo));
}

interface ControllerOpts {
  onUpdate: (tally: Tally) => void;
  p1Team: string; // packed team Blue plays (from the Reg M-B registry)
  p2Team: string; // packed team Red plays
  initial?: Tally; // resume the running tally (Stop → Start keeps accumulating)
}

export class AutoBattleController {
  private readonly onUpdate: (tally: Tally) => void;
  private readonly p1Team: string;
  private readonly p2Team: string;
  private readonly formatid = FORMATS.vgcregmb.engineFormat;
  private stopped = true;
  private destroyed = false;
  private looping = false;
  private counts = { blue: 0, red: 0, ties: 0, games: 0 };
  private readonly leadBlue = new Map<string, number>();
  private readonly leadRed = new Map<string, number>();
  private lastEmit = 0;

  // The stream of the game currently in flight, so stop()/destroy() can tear it down and let
  // the in-flight `for await` resolve.
  private activeStreams: ReturnType<typeof BattleStreams.getPlayerStreams> | null = null;

  constructor(opts: ControllerOpts) {
    this.onUpdate = opts.onUpdate;
    this.p1Team = opts.p1Team;
    this.p2Team = opts.p2Team;
    if (opts.initial) {
      const { blue, red, ties, games } = opts.initial;
      this.counts = { blue, red, ties, games };
      for (const { combo, count } of opts.initial.leadsBlue ?? []) this.leadBlue.set(combo, count);
      for (const { combo, count } of opts.initial.leadsRed ?? []) this.leadRed.set(combo, count);
    }
  }

  start() {
    if (this.destroyed || this.looping) return;
    this.stopped = false;
    this.looping = true;
    void this.runLoop();
  }

  /** Halt the loop; the in-flight game is abandoned. Idempotent. Flushes a final tally. */
  stop() {
    this.stopped = true;
    this.endActive();
    this.emit(true);
  }

  /** Halt permanently and stop emitting (e.g. on React unmount). */
  destroy() {
    this.destroyed = true;
    this.stopped = true;
    this.endActive();
  }

  getTally(): Tally {
    return this.snapshot();
  }

  private endActive() {
    const s = this.activeStreams;
    this.activeStreams = null;
    if (!s) return;
    try {
      void s.omniscient.writeEnd();
    } catch {
      /* already torn down */
    }
  }

  private async runLoop() {
    try {
      while (!this.stopped && !this.destroyed) {
        const outcome = await this.runGame();
        if (this.stopped || this.destroyed) break;
        if (outcome.result === "blue") this.counts.blue++;
        else if (outcome.result === "red") this.counts.red++;
        else this.counts.ties++;
        this.counts.games++;
        if (outcome.blueLead) this.leadBlue.set(outcome.blueLead, (this.leadBlue.get(outcome.blueLead) ?? 0) + 1);
        if (outcome.redLead) this.leadRed.set(outcome.redLead, (this.leadRed.get(outcome.redLead) ?? 0) + 1);
        this.emit(false);
        // Yield to the event loop so the Start/Stop button and React stay responsive even
        // when thousands of games run per second.
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      this.looping = false;
      this.endActive();
      this.emit(true);
    }
  }

  /** Play one full game to completion (or until stopped). Resolves with the winner + leads. */
  private async runGame(): Promise<GameOutcome> {
    const streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());
    this.activeStreams = streams;

    // Two random players with randomized leads — fresh PRNG each, so play varies every game.
    const ai1 = new LeadRandomAI(streams.p1);
    const ai2 = new LeadRandomAI(streams.p2);
    void ai1.start();
    void ai2.start();

    void streams.omniscient.write(
      `>start ${JSON.stringify({ formatid: this.formatid })}\n` +
        `>player p1 ${JSON.stringify({ name: P1_NAME, team: this.p1Team })}\n` +
        `>player p2 ${JSON.stringify({ name: P2_NAME, team: this.p2Team })}`
    );

    // First species to appear in each active slot = that side's lead (never overwritten).
    const p1Lead: (string | null)[] = [null, null];
    const p2Lead: (string | null)[] = [null, null];

    let result: GameResult = "tie";
    try {
      for await (const chunk of streams.omniscient) {
        if (this.stopped || this.destroyed) break;
        let done = false;
        for (const line of chunk.split("\n")) {
          if (line.startsWith("|switch|") || line.startsWith("|drag|")) {
            const parts = line.split("|"); // ["", "switch", "p1a: X", "Species, L50, M", ...]
            const pos = parts[2] ?? "";
            const species = cleanName(parts[3] ?? "");
            const slot = pos.charAt(2) === "b" ? 1 : 0;
            if (pos.startsWith("p1") && p1Lead[slot] === null) p1Lead[slot] = species;
            else if (pos.startsWith("p2") && p2Lead[slot] === null) p2Lead[slot] = species;
            continue;
          }
          if (line.startsWith("|win|")) {
            const winner = line.slice("|win|".length).trim();
            result = winner === P1_NAME ? "blue" : winner === P2_NAME ? "red" : "tie";
            done = true;
            break;
          }
          if (line === "|tie" || line.startsWith("|tie|")) {
            result = "tie";
            done = true;
            break;
          }
        }
        if (done) break;
      }
    } catch {
      // stream torn down on stop/destroy — treat as no result (loop will exit on the flag)
    } finally {
      if (this.activeStreams === streams) this.activeStreams = null;
      try {
        void streams.omniscient.writeEnd();
      } catch {
        /* noop */
      }
    }
    return { result, blueLead: comboKey(p1Lead[0], p1Lead[1]), redLead: comboKey(p2Lead[0], p2Lead[1]) };
  }

  private snapshot(): Tally {
    return {
      ...this.counts,
      leadsBlue: sortLeads(this.leadBlue),
      leadsRed: sortLeads(this.leadRed),
    };
  }

  // Throttle UI updates to ~4x/sec so a turbo loop doesn't flood React with renders. `force`
  // (stop/final) always emits.
  private emit(force: boolean) {
    if (this.destroyed) return; // never emit after unmount
    const now = Date.now();
    if (!force && now - this.lastEmit < 250) return;
    this.lastEmit = now;
    this.onUpdate(this.snapshot());
  }
}

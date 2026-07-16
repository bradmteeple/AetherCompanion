// Client-side battle driver: runs a real Pokémon Showdown battle in the browser.
//
// Uses @pkmn/sim (Showdown's battle engine, repackaged for bundlers) + @pkmn/randoms
// (the random-battle team generators). The vendored copy of the full engine lives in
// /pokemon-showdown; @pkmn/sim is the same simulator built to run outside Node so it can
// be bundled into a static site. Mechanics are identical to the games / play.pokemonshowdown.com.

import "./node-shim"; // must precede any @pkmn import — defines Node globals for the browser
import { BattleStreams, Teams, RandomPlayerAI } from "@pkmn/sim";
import { TeamGenerators } from "@pkmn/randoms";
import { describeLine, type BoardState } from "./protocol";

// Wire the random-team generators into the sim so `gen9randombattle` can build teams.
Teams.setGeneratorFactory(TeamGenerators);

export interface MoveOption {
  index: number; // 1-based, as the protocol expects ("move 1")
  name: string;
  pp: number;
  maxpp: number;
  type: "move";
  disabled: boolean;
}

export interface SwitchOption {
  index: number; // 1-based slot ("switch 3")
  name: string;
  hpPct: number;
  status: string;
  fainted: boolean;
  active: boolean;
  type: "switch";
}

export interface BattleSnapshot {
  log: string[];
  board: BoardState;
  moves: MoveOption[];
  switches: SwitchOption[];
  // What the engine is currently asking the human player for.
  prompt: "move" | "switch" | "wait" | "none";
  ended: boolean;
  winner: string | null;
}

const FORMAT = "gen9randombattle";

export class BattleController {
  private streams: ReturnType<typeof BattleStreams.getPlayerStreams>;
  private destroyed = false;
  private snapshot: BattleSnapshot;
  private onUpdate: (s: BattleSnapshot) => void;

  constructor(onUpdate: (s: BattleSnapshot) => void) {
    this.onUpdate = onUpdate;
    this.snapshot = {
      log: [],
      board: { p1: null, p2: null },
      moves: [],
      switches: [],
      prompt: "none",
      ended: false,
      winner: null,
    };
    this.streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());
    this.start();
  }

  private emit() {
    if (!this.destroyed) this.onUpdate({ ...this.snapshot, log: [...this.snapshot.log] });
  }

  private pushLog(line: string) {
    this.snapshot.log.push(line);
  }

  private start() {
    // Opponent is driven by Showdown's built-in random AI.
    const ai = new RandomPlayerAI(this.streams.p2);
    void ai.start();

    // Consume the human player's view of the battle.
    void this.readPlayerStream();

    const spec = { formatid: FORMAT };
    const p1 = { name: "You", team: Teams.pack(Teams.generate(FORMAT)) };
    const p2 = { name: "Rival AI", team: Teams.pack(Teams.generate(FORMAT)) };

    void this.streams.omniscient.write(
      `>start ${JSON.stringify(spec)}\n` +
        `>player p1 ${JSON.stringify(p1)}\n` +
        `>player p2 ${JSON.stringify(p2)}`
    );
  }

  private async readPlayerStream() {
    try {
      for await (const chunk of this.streams.p1) {
        if (this.destroyed) return;
        for (const line of chunk.split("\n")) {
          if (line.startsWith("|request|")) {
            this.handleRequest(line.slice("|request|".length));
          } else if (line.startsWith("|error|")) {
            this.pushLog(`⚠️ ${line.slice("|error|".length)}`);
          } else if (line.startsWith("|win|")) {
            this.snapshot.winner = line.slice("|win|".length).trim();
            this.snapshot.ended = true;
            this.snapshot.prompt = "none";
            const text = describeLine(line, this.snapshot.board);
            if (text) this.pushLog(text);
          } else if (line === "|tie" || line.startsWith("|tie|")) {
            this.snapshot.ended = true;
            this.snapshot.prompt = "none";
            this.pushLog("The battle ended in a tie.");
          } else {
            const text = describeLine(line, this.snapshot.board);
            if (text) this.pushLog(text);
          }
        }
        this.emit();
      }
    } catch {
      // stream torn down on reset — ignore
    }
  }

  private handleRequest(json: string) {
    if (!json) {
      this.snapshot.prompt = "wait";
      this.snapshot.moves = [];
      this.snapshot.switches = [];
      return;
    }
    const req = JSON.parse(json);
    const side = req.side;
    const switches: SwitchOption[] = (side?.pokemon ?? []).map((p: any, i: number) => {
      const c = parseCond(p.condition ?? "0/0");
      return {
        index: i + 1,
        name: cleanName(p.details ?? p.ident ?? "?"),
        hpPct: c.hpPct,
        status: c.status,
        fainted: c.fainted,
        active: !!p.active,
        type: "switch" as const,
      };
    });
    this.snapshot.switches = switches;

    if (req.wait) {
      this.snapshot.prompt = "wait";
      this.snapshot.moves = [];
      return;
    }

    if (req.forceSwitch) {
      this.snapshot.prompt = "switch";
      this.snapshot.moves = [];
      return;
    }

    // Normal turn: expose the active Pokémon's moves.
    const active = req.active?.[0];
    const moves: MoveOption[] = (active?.moves ?? []).map((m: any, i: number) => ({
      index: i + 1,
      name: m.move,
      pp: m.pp ?? 0,
      maxpp: m.maxpp ?? 0,
      disabled: !!m.disabled,
      type: "move" as const,
    }));
    this.snapshot.moves = moves;
    this.snapshot.prompt = "move";
  }

  /** Send the human player's decision to the engine. */
  choose(choice: string) {
    if (this.destroyed || this.snapshot.ended) return;
    this.snapshot.prompt = "wait";
    this.emit();
    void this.streams.p1.write(choice);
  }

  chooseMove(index: number) {
    this.choose(`move ${index}`);
  }

  chooseSwitch(index: number) {
    this.choose(`switch ${index}`);
  }

  destroy() {
    this.destroyed = true;
    try {
      void this.streams.omniscient.writeEnd();
    } catch {
      /* noop */
    }
  }
}

function parseCond(cond: string): { hpPct: number; status: string; fainted: boolean } {
  const [hpPart, status = ""] = String(cond).trim().split(" ");
  if (hpPart === "0" || status === "fnt") return { hpPct: 0, status: "fnt", fainted: true };
  const [cur, max] = hpPart.split("/").map((n) => parseInt(n, 10));
  const hpPct = max ? Math.round((cur / max) * 100) : 0;
  return { hpPct, status, fainted: false };
}

// "Pikachu, L84, M" / "Great Tusk" -> "Pikachu" / "Great Tusk"
function cleanName(details: string): string {
  return details.split(",")[0].trim();
}

// Converts Pokémon Showdown battle-protocol lines into human-readable text.
// See pokemon-showdown/sim/SIM-PROTOCOL.md (vendored) for the full spec.

export interface ActiveMon {
  name: string;
  hpPct: number;
  status: string;
  fainted: boolean;
}

export interface BoardState {
  // Only singles is used here, so each side has a single active slot ("a").
  p1: ActiveMon | null;
  p2: ActiveMon | null;
}

// Strip the "p1a: " position prefix, returning [sideId, displayName].
function parseIdent(raw: string): { side: "p1" | "p2"; name: string } {
  const [pos, ...rest] = raw.split(": ");
  const side = pos.slice(0, 2) as "p1" | "p2";
  return { side, name: rest.join(": ") || pos };
}

// Parse an HP "condition" string: "184/240", "52/100 par", "0 fnt".
function parseCondition(cond: string): { hpPct: number; status: string; fainted: boolean } {
  const [hpPart, status = ""] = cond.trim().split(" ");
  if (hpPart === "0" || status === "fnt") return { hpPct: 0, status: "fnt", fainted: true };
  const [cur, max] = hpPart.split("/").map((n) => parseInt(n, 10));
  const hpPct = max ? Math.round((cur / max) * 100) : 0;
  return { hpPct, status, fainted: false };
}

const who = (side: "p1" | "p2") => (side === "p1" ? "Your" : "Foe");

// Handle one protocol line. Mutates `board`, returns a log string (or null to skip).
export function describeLine(line: string, board: BoardState): string | null {
  if (!line.startsWith("|")) return null;
  const parts = line.slice(1).split("|");
  const cmd = parts[0];

  const setActive = (identRaw: string, cond?: string) => {
    const { side, name } = parseIdent(identRaw);
    const prev = board[side];
    const base: ActiveMon = { name, hpPct: 100, status: "", fainted: false };
    const next = cond ? { ...base, ...parseCondition(cond) } : base;
    board[side] = next;
    return { side, name, prev };
  };
  const updateHp = (identRaw: string, cond: string) => {
    const { side, name } = parseIdent(identRaw);
    const c = parseCondition(cond);
    board[side] = { name, hpPct: c.hpPct, status: c.status, fainted: c.fainted };
    return { side, name, ...c };
  };

  switch (cmd) {
    case "player":
      return null;
    case "switch":
    case "drag": {
      const { side, name } = setActive(parts[1], parts[3]);
      const verb = cmd === "drag" ? "was dragged out" : "sent out";
      return side === "p1" ? `You ${verb} ${name}!` : `Foe ${verb} ${name}!`;
    }
    case "move": {
      const { side, name } = parseIdent(parts[1]);
      return `${side === "p1" ? name : "Foe " + name} used ${parts[2]}!`;
    }
    case "-damage": {
      const { side, name, hpPct, fainted } = updateHp(parts[1], parts[2]);
      if (fainted) return null; // a following |faint| line reports it
      return `${who(side)} ${name} is at ${hpPct}% HP.`;
    }
    case "-heal": {
      const { side, name, hpPct } = updateHp(parts[1], parts[2]);
      return `${who(side)} ${name} restored HP (${hpPct}%).`;
    }
    case "-sethp": {
      updateHp(parts[1], parts[2]);
      return null;
    }
    case "faint": {
      const { side, name } = parseIdent(parts[1]);
      if (board[side]) board[side] = { ...board[side]!, hpPct: 0, fainted: true, status: "fnt" };
      return `${side === "p1" ? "Your" : "Foe"} ${name} fainted!`;
    }
    case "-status": {
      const { side, name } = parseIdent(parts[1]);
      if (board[side]) board[side] = { ...board[side]!, status: parts[2] };
      const label: Record<string, string> = {
        brn: "was burned", par: "was paralyzed", psn: "was poisoned",
        tox: "was badly poisoned", slp: "fell asleep", frz: "was frozen solid",
      };
      return `${who(side)} ${name} ${label[parts[2]] ?? "was afflicted with " + parts[2]}!`;
    }
    case "-curestatus": {
      const { side, name } = parseIdent(parts[1]);
      if (board[side]) board[side] = { ...board[side]!, status: "" };
      return `${who(side)} ${name} recovered.`;
    }
    case "-supereffective":
      return "It's super effective!";
    case "-resisted":
      return "It's not very effective...";
    case "-immune": {
      const { side, name } = parseIdent(parts[1]);
      return `It doesn't affect ${side === "p1" ? "your" : "the foe's"} ${name}...`;
    }
    case "-crit":
      return "A critical hit!";
    case "-miss": {
      const { side, name } = parseIdent(parts[1] || "");
      return parts[1] ? `${who(side)} ${name}'s attack missed!` : "The attack missed!";
    }
    case "-fail":
      return "But it failed!";
    case "-boost":
    case "-unboost": {
      const { side, name } = parseIdent(parts[1]);
      const dir = cmd === "-boost" ? "rose" : "fell";
      const amt = parseInt(parts[3], 10) > 1 ? " sharply" : "";
      return `${who(side)} ${name}'s ${statName(parts[2])} ${dir}${amt}!`;
    }
    case "-ability": {
      const { side, name } = parseIdent(parts[1]);
      return `[${who(side)} ${name}'s ${parts[2]}]`;
    }
    case "-item": {
      const { side, name } = parseIdent(parts[1]);
      return `${who(side)} ${name}'s ${parts[2]} activated.`;
    }
    case "-enditem": {
      const { side, name } = parseIdent(parts[1]);
      return `${who(side)} ${name}'s ${parts[2]} was used up.`;
    }
    case "-weather":
      return parts[1] && parts[1] !== "none" ? `The weather is ${parts[1]}.` : null;
    case "-fieldstart":
      return parts[1] ? `${cleanEffect(parts[1])} took effect.` : null;
    case "-fieldend":
      return parts[1] ? `${cleanEffect(parts[1])} ended.` : null;
    case "-sidestart": {
      const { side } = parseIdent(parts[1] + ": ");
      return `${cleanEffect(parts[2])} set on ${side === "p1" ? "your" : "the foe's"} side.`;
    }
    case "-activate":
      return parts[2] ? `${cleanEffect(parts[2])} activated.` : null;
    case "-start": {
      const { side, name } = parseIdent(parts[1]);
      return `${who(side)} ${name}: ${cleanEffect(parts[2])}.`;
    }
    case "-end":
      return null;
    case "cant": {
      const { side, name } = parseIdent(parts[1]);
      return `${who(side)} ${name} couldn't move!`;
    }
    case "turn":
      return `\n— Turn ${parts[1]} —`;
    case "win":
      return `\n🏆 ${parts[1]} won the battle!`;
    case "tie":
      return "\nThe battle ended in a tie.";
    case "-hitcount":
      return `Hit ${parts[2]} time(s)!`;
    case "-clearallboost":
    case "-clearboost":
      return "Stat changes were cleared.";
    default:
      return null;
  }
}

function statName(id: string): string {
  const map: Record<string, string> = {
    atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def",
    spe: "Speed", accuracy: "accuracy", evasion: "evasiveness",
  };
  return map[id] ?? id;
}

function cleanEffect(raw: string): string {
  return raw.replace(/^(move|ability|item|condition|move: |ability: |item: )/, "").trim();
}

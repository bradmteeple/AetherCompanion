// Blue's game-plan data + rendering. This module is intentionally dependency-free (no @pkmn,
// no engine) so the Auto Battle page and the flowchart page can import the encoder/renderer
// without pulling the Showdown engine into their initial bundle. The heavy analysis that
// derives a PlanData from a run lives in game-plan-analyze.ts (loaded only inside auto-engine).

export interface PlanThreat {
  species: string; // Red Pokémon to prioritize
  move: string; // the strongest move Blue saw it use
}

export interface PlanData {
  blueTeam: string; // Blue team label
  redTeam: string; // Red team label
  games: number;
  blueWins: number;
  redWins: number;
  winPct: number; // Blue's share of decided games (0..100)
  archetype: "Trick Room" | "Tailwind" | "Tempo";
  selection: string[]; // the best-win-rate 4-of-6 Blue brought
  selectionWinPct: number;
  selectionGames: number;
  lead: { mons: string[]; reason: string };
  threats: PlanThreat[];
}

// ---- Rendering (pure) ------------------------------------------------------------------------

const esc = (s: string) => s.replace(/"/g, "'"); // keep labels safe inside quoted mermaid nodes

export function planToMermaid(p: PlanData): string {
  const bring = p.selection.length ? p.selection.join(", ") : "your best four";
  const leadTxt = p.lead.mons.length ? p.lead.mons.join(" + ") : "your two strongest";
  const threatList = p.threats.length
    ? p.threats.map((t) => `${t.species}${t.move ? ` (${t.move})` : ""}`).join(" · ")
    : "the opponent's biggest attacker";
  const speedTool = p.archetype === "Tempo" ? "your speed control" : p.archetype;

  const L = (s: string) => `"${esc(s)}"`;
  return [
    "flowchart TD",
    `  Start([${L(`Bring these 4:<br/>${bring}<br/>(${p.selectionWinPct}% win rate over ${p.selectionGames} games)`)}]) --> Lead`,
    `  Lead[${L(`Lead: ${leadTxt}<br/>${p.lead.reason}`)}] --> Turn`,
    `  Turn{{${L("Each turn, in order")}}} --> Q1`,
    `  Q1{${L(`Is a top Red threat on the field?<br/>${threatList}`)}}`,
    `  Q1 -- Yes --> A1[${L("Gang up and KO it first — hit it with your best super-effective move from both slots")}]`,
    `  Q1 -- No --> Q2`,
    `  Q2{${L("Can you secure a KO this turn?")}}`,
    `  Q2 -- Yes --> A2[${L("Take the KO — remove the most dangerous target first")}]`,
    `  Q2 -- No --> Q3`,
    `  Q3{${L(`Behind on speed with ${speedTool} available?`)}}`,
    `  Q3 -- Yes --> A3[${L(`Set ${speedTool} to flip the speed war in your favor`)}]`,
    `  Q3 -- No --> Q4`,
    `  Q4{${L("Under pressure with Protect / Fake Out / redirection up?")}}`,
    `  Q4 -- Yes --> A4[${L("Buy tempo — Protect the threatened mon, Fake Out or redirect their key attacker")}]`,
    `  Q4 -- No --> A5[${L("Otherwise: deal the most damage to the most dangerous target")}]`,
    `  A1 --> Loop`,
    `  A2 --> Loop`,
    `  A3 --> Loop`,
    `  A4 --> Loop`,
    `  A5 --> Loop`,
    `  Loop([${L("Repeat until the last Red Pokémon faints")}])`,
  ].join("\n");
}

export function planToBullets(p: PlanData): string[] {
  const out: string[] = [];
  if (p.selection.length) {
    out.push(
      `Bring ${p.selection.join(", ")} — your best selection at a ${p.selectionWinPct}% win rate over ${p.selectionGames.toLocaleString()} games.`
    );
  }
  if (p.lead.mons.length) out.push(`Lead ${p.lead.mons.join(" + ")}: ${p.lead.reason}`);
  if (p.threats.length) {
    out.push(
      `Prioritize KO-ing ${p.threats.map((t) => `${t.species}${t.move ? ` (${t.move})` : ""}`).join(", ")} — the threats Blue learned hurt most.`
    );
  }
  out.push("Every turn: threats first, then guaranteed KOs, then speed control, then tempo tools, else max damage.");
  return out;
}

// ---- URL encode / decode (browser btoa/atob, UTF-8 safe) -------------------------------------

export function encodePlan(p: PlanData): string {
  const json = JSON.stringify(p);
  return encodeURIComponent(btoa(unescape(encodeURIComponent(json))));
}

export function decodePlan(s: string): PlanData | null {
  try {
    const json = decodeURIComponent(escape(atob(decodeURIComponent(s))));
    return JSON.parse(json) as PlanData;
  } catch {
    return null;
  }
}

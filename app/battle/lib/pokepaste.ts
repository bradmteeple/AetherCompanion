// Load a custom team from a PokePaste (pokepast.es) URL or from raw Showdown export text.
//
// PokePaste exposes /<id>/json and /<id>/raw. We fetch client-side; if that fails (CORS/network),
// the caller can fall back to the raw team text (which importTeam also accepts). Team parsing/packing
// reuses @pkmn/sim's Teams API already used by the engine.

import "./node-shim"; // must precede any @pkmn import
import { Teams, TeamValidator } from "@pkmn/sim";

const POKEPASTE_RE = /pokepast\.es\/([A-Za-z0-9]+)/;

export function pokepasteId(input: string): string | null {
  const m = POKEPASTE_RE.exec(input.trim());
  return m ? m[1] : null;
}

export function looksLikeUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim()) || POKEPASTE_RE.test(input.trim());
}

// Fetch the export text for a PokePaste URL. Throws a friendly Error on failure.
export async function fetchPokepaste(input: string): Promise<string> {
  const id = pokepasteId(input);
  if (!id) throw new Error("That doesn't look like a pokepast.es link.");
  const base = `https://pokepast.es/${id}`;
  // Prefer the JSON endpoint (has the team in `.paste`); fall back to /raw.
  try {
    const res = await fetch(`${base}/json`, { headers: { Accept: "application/json" } });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.paste === "string" && data.paste.trim()) return data.paste;
    }
  } catch {
    /* try /raw next */
  }
  try {
    const res = await fetch(`${base}/raw`);
    if (res.ok) {
      const text = await res.text();
      if (text.trim()) return text;
    }
  } catch {
    /* fall through to error */
  }
  throw new Error(
    "Couldn't fetch that PokePaste (the site may block cross-site requests). Paste the team's export text instead."
  );
}

export interface LoadedTeam {
  packed: string;
  species: string[];
}

// Parse Showdown export text into a packed team + species list. Returns null if it isn't a team.
export function importTeam(text: string): LoadedTeam | null {
  try {
    const sets = Teams.import(text);
    if (!sets || !sets.length) return null;
    const packed = Teams.pack(sets);
    if (!packed) return null;
    const species = sets.map((s: any) => s.species || s.name).filter(Boolean);
    return { packed, species };
  } catch {
    return null;
  }
}

export interface ValidatedTeam extends LoadedTeam {
  problems: string[]; // blocking rule violations for the given format; empty means legal-enough
}

// The Reg M-B teams this app ships intentionally rely on things the strict Gen 9 validator rejects
// but the lenient battle engine runs anyway: the (fictional) Floettite stone and a couple of
// out-of-era moves. We hold uploads to the SAME practical bar the presets meet — so we ignore those
// tolerated categories and keep the substantive rules (EV budget, team size, bans, level, clauses).
const TOLERATED = [
  /can't learn/i, // out-of-era / movepool moves the engine still runs
  /can't be transferred/i, // Gen 8→9 move-transfer legality the engine ignores
  /does not exist in Gen/i, // fictional Mega formes / stones (e.g. Floettite)
  /does not restrict you to 510 EVs/i, // cosmetic "add 1 EV" note, not a real violation
  /is not obtainable/i,
];

// Parse a team AND validate it against a format id (e.g. the Reg M-B engineFormat). Returns null if
// the text isn't a readable team at all; otherwise `problems` lists blocking legality issues (empty
// when the team is legal enough to run). The substantive Reg M-B check that matters here is the
// 66-EV Champions budget, which rejects standard 508-EV Showdown teams.
export function importTeamValidated(text: string, formatid: string): ValidatedTeam | null {
  let sets: any[] | null;
  try {
    sets = Teams.import(text);
  } catch {
    return null;
  }
  if (!sets || !sets.length) return null;
  const packed = Teams.pack(sets);
  if (!packed) return null;
  const species = sets.map((s: any) => s.species || s.name).filter(Boolean);
  let raw: string[] = [];
  try {
    raw = new TeamValidator(formatid as any).validateTeam(sets) || [];
  } catch {
    raw = ["Couldn't validate this team against the Reg M-B ruleset."];
  }
  const problems = raw.filter((p) => !TOLERATED.some((re) => re.test(p)));
  return { packed, species, problems };
}

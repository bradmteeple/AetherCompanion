"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BattleSnapshot, MoveOption, SwitchOption } from "./lib/engine";
import type { ActiveMon } from "./lib/protocol";

const TYPE_HINT = "Powered by the real Pokémon Showdown battle engine.";

export default function BattlePage() {
  const [snapshot, setSnapshot] = useState<BattleSnapshot | null>(null);
  const [battleKey, setBattleKey] = useState(0);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const moveHandlers = useRef<{
    chooseMove: (i: number) => void;
    chooseSwitch: (i: number) => void;
  } | null>(null);

  // Instantiate the battle engine on the client only (it can't run during SSR/export).
  useEffect(() => {
    let controller: import("./lib/engine").BattleController | null = null;
    let cancelled = false;

    (async () => {
      const { BattleController } = await import("./lib/engine");
      if (cancelled) return;
      controller = new BattleController((s) => setSnapshot(s));
      moveHandlers.current = {
        chooseMove: (i) => controller!.chooseMove(i),
        chooseSwitch: (i) => controller!.chooseSwitch(i),
      };
    })();

    return () => {
      cancelled = true;
      controller?.destroy();
      moveHandlers.current = null;
    };
  }, [battleKey]);

  // Auto-scroll the log to the newest line.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [snapshot?.log.length]);

  const newBattle = useCallback(() => {
    setSnapshot(null);
    setBattleKey((k) => k + 1);
  }, []);

  const loading = !snapshot;

  return (
    <>
      <h1 className="page-title">Battle</h1>
      <p className="page-text">
        {TYPE_HINT} A fresh Gen 9 random team each match — play against the AI.
      </p>

      <div className="battle-toolbar">
        <button className="battle-btn battle-btn--ghost" onClick={newBattle}>
          ↻ New Battle
        </button>
        {snapshot?.ended && snapshot.winner && (
          <span className="battle-result">
            {snapshot.winner === "You" ? "🏆 You won!" : `Defeat — ${snapshot.winner} won.`}
          </span>
        )}
      </div>

      {loading ? (
        <div className="battle-loading">Generating teams and starting the battle…</div>
      ) : (
        <div className="battle-grid">
          <div className="battle-field">
            <MonCard mon={snapshot.board.p2} side="Rival AI" foe />
            <MonCard mon={snapshot.board.p1} side="You" />
          </div>

          <div className="battle-log" aria-live="polite">
            {snapshot.log.map((line, i) => (
              <div
                key={i}
                className={
                  "battle-log-line" +
                  (line.startsWith("\n") ? " battle-log-line--turn" : "") +
                  (line.startsWith("⚠️") ? " battle-log-line--warn" : "")
                }
              >
                {line.trim()}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>

          <ChoicePanel
            snapshot={snapshot}
            onMove={(i) => moveHandlers.current?.chooseMove(i)}
            onSwitch={(i) => moveHandlers.current?.chooseSwitch(i)}
            onNewBattle={newBattle}
          />
        </div>
      )}
    </>
  );
}

function MonCard({ mon, side, foe }: { mon: ActiveMon | null; side: string; foe?: boolean }) {
  return (
    <div className={"mon-card" + (foe ? " mon-card--foe" : "")}>
      <div className="mon-card-head">
        <span className="mon-side">{side}</span>
        <span className="mon-name">{mon ? mon.name : "—"}</span>
        {mon?.status && <span className="mon-status">{mon.status.toUpperCase()}</span>}
      </div>
      <div className="hp-bar">
        <div
          className={
            "hp-fill" +
            (mon && mon.hpPct <= 20
              ? " hp-fill--low"
              : mon && mon.hpPct <= 50
              ? " hp-fill--mid"
              : "")
          }
          style={{ width: `${mon ? mon.hpPct : 0}%` }}
        />
      </div>
      <div className="hp-label">{mon ? (mon.fainted ? "Fainted" : `${mon.hpPct}%`) : ""}</div>
    </div>
  );
}

function ChoicePanel({
  snapshot,
  onMove,
  onSwitch,
  onNewBattle,
}: {
  snapshot: BattleSnapshot;
  onMove: (i: number) => void;
  onSwitch: (i: number) => void;
  onNewBattle: () => void;
}) {
  if (snapshot.ended) {
    return (
      <div className="choice-panel">
        <p className="choice-hint">The battle is over.</p>
        <button className="battle-btn" onClick={onNewBattle}>
          Play again
        </button>
      </div>
    );
  }

  if (snapshot.prompt === "wait") {
    return (
      <div className="choice-panel">
        <p className="choice-hint">Waiting for the opponent…</p>
      </div>
    );
  }

  if (snapshot.prompt === "switch") {
    return (
      <div className="choice-panel">
        <p className="choice-hint">Choose a Pokémon to send out:</p>
        <SwitchButtons switches={snapshot.switches} onSwitch={onSwitch} forced />
      </div>
    );
  }

  if (snapshot.prompt === "move") {
    return (
      <div className="choice-panel">
        <p className="choice-hint">Choose a move:</p>
        <div className="move-grid">
          {snapshot.moves.map((m: MoveOption) => (
            <button
              key={m.index}
              className="move-btn"
              disabled={m.disabled || m.pp === 0}
              onClick={() => onMove(m.index)}
            >
              <span className="move-name">{m.name}</span>
              <span className="move-pp">
                {m.pp}/{m.maxpp} PP
              </span>
            </button>
          ))}
        </div>
        <p className="choice-hint choice-hint--sub">…or switch:</p>
        <SwitchButtons switches={snapshot.switches} onSwitch={onSwitch} />
      </div>
    );
  }

  return <div className="choice-panel" />;
}

function SwitchButtons({
  switches,
  onSwitch,
  forced,
}: {
  switches: SwitchOption[];
  onSwitch: (i: number) => void;
  forced?: boolean;
}) {
  return (
    <div className="switch-grid">
      {switches.map((s) => (
        <button
          key={s.index}
          className="switch-btn"
          disabled={s.fainted || (!forced && s.active)}
          onClick={() => onSwitch(s.index)}
        >
          <span className="switch-name">{s.name}</span>
          <span className="switch-hp">
            {s.fainted ? "Fainted" : s.active ? "Active" : `${s.hpPct}%`}
          </span>
        </button>
      ))}
    </div>
  );
}

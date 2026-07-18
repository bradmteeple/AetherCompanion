"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  decodePlan,
  planToBullets,
  planToMermaid,
  type PlanData,
} from "../../battle/lib/game-plan";

export default function PlanPage() {
  // undefined = still reading the URL; null = no/invalid data.
  const [plan, setPlan] = useState<PlanData | null | undefined>(undefined);
  const [svg, setSvg] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get("d");
    setPlan(d ? decodePlan(d) : null);
  }, []);

  useEffect(() => {
    if (!plan) return;
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "loose",
          flowchart: { htmlLabels: true, curve: "basis", useMaxWidth: true },
        });
        const { svg } = await mermaid.render("blueplan", planToMermaid(plan));
        if (!cancelled) setSvg(svg);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plan]);

  if (plan === undefined) {
    return <div className="battle-loading">Loading game plan…</div>;
  }

  if (plan === null) {
    return (
      <div className="plan-page">
        <h1 className="page-title">Game plan</h1>
        <p className="page-text">
          No plan data in this link. Open the Auto Battle tab, run a matchup, and press Stop to
          generate a shareable plan.
        </p>
        <Link className="battle-btn" href="/auto-mode">
          ← Back to Auto Battle
        </Link>
      </div>
    );
  }

  const bullets = planToBullets(plan);

  return (
    <div className="plan-page">
      <h1 className="page-title">Blue&apos;s game plan</h1>
      <p className="page-text">
        How <strong className="plan-blue">{plan.blueTeam}</strong> (Blue) played against{" "}
        <strong className="plan-red">{plan.redTeam}</strong> (Red) — a {plan.archetype} plan derived
        from {plan.games.toLocaleString()} self-play games.
      </p>

      <div className="plan-badges">
        <span className="plan-badge plan-badge--blue">Blue win rate {plan.winPct}%</span>
        <span className="plan-badge">
          {plan.blueWins.toLocaleString()}–{plan.redWins.toLocaleString()} decided
        </span>
        <span className="plan-badge">{plan.archetype}</span>
      </div>

      <ul className="plan-bullets">
        {bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>

      <div className="plan-chart">
        {err ? (
          <p className="ct-error">Couldn&apos;t render the flowchart: {err}</p>
        ) : svg ? (
          <div className="plan-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <p className="page-text">Drawing flowchart…</p>
        )}
      </div>

      <div className="plan-actions">
        <Link className="battle-btn battle-btn--ghost" href="/auto-mode">
          ← Back to Auto Battle
        </Link>
      </div>
    </div>
  );
}

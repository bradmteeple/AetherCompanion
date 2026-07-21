"""
Auto Battle: the Adaptive AI trains by battling itself, permanently.

Auto Battle runs self-play -- two copies of the policy playing each other -- and
that self-play *is* the Adaptive AI's training. It writes to the ``bc_sp``
checkpoint lineage that Level 3 is founded on, and resumes from wherever it left
off, so every run permanently accumulates: the longer you run Auto Battle, the
stronger the Adaptive AI gets. Your own games (via ``play.py --save-logs`` +
``improve.py``) then adapt this foundation to how you play.

It orchestrates the existing, tested trainer -- nothing here re-implements
training:

    train --self_play --behavior_clone --total_steps <current + increment>

Each round raises the total-step target by ``--steps_per_round`` above the
latest checkpoint, so training always moves forward (train.py resumes from the
newest checkpoint and stops once the target is reached). Use ``--forever`` to
keep battling round after round until you stop it, or ``--rounds N`` for a fixed
number.

Requirements: a CUDA GPU, the ML extras (``pip install .[dev]``), and a running
pokemon-showdown server. Run from the repo root. ``--dry-run`` prints the
commands and resolved paths without training (no GPU/deps needed).
"""

import argparse
import subprocess
import sys

from vgc_bench.src.levels import latest_timestep, method_save_dir

# self-play + behavior-cloning init -> train.py method tag "bc_sp". This is the
# Adaptive AI's self-play foundation that Level 3 (method "auto") falls back to.
AUTO_BATTLE_METHOD = "bc_sp"


def auto_battle(
    reg: str | None,
    run_id: int,
    num_teams: int | None,
    port: int,
    device: str,
    steps_per_round: int,
    rounds: int,
    forever: bool,
    results_path: str = "results",
    dry_run: bool = False,
) -> None:
    """Run self-play rounds that permanently extend the Adaptive AI foundation."""
    py = sys.executable
    save_dir = method_save_dir(results_path, AUTO_BATTLE_METHOD, reg, num_teams, run_id)

    def round_cmd(target_steps: int) -> list[str]:
        cmd = [
            py, "-m", "vgc_bench.train",
            "--self_play", "--behavior_clone",
            "--run_id", str(run_id),
            "--total_steps", str(target_steps),
            "--port", str(port), "--device", device,
        ]
        if reg is not None:
            cmd += ["--reg", reg]
        if num_teams is not None:
            cmd += ["--num_teams", str(num_teams)]
        return cmd

    if dry_run:
        current = latest_timestep(results_path, AUTO_BATTLE_METHOD, reg, num_teams, run_id)
        print(f"[dry-run] Auto Battle foundation: {save_dir}")
        print(f"[dry-run] latest checkpoint timestep: {current}")
        print(f"[dry-run] mode: {'forever' if forever else f'{rounds} round(s)'}, "
              f"+{steps_per_round} steps/round")
        print(f"[dry-run] round 1 cmd: {' '.join(round_cmd(current + steps_per_round))}")
        print(f"[dry-run] Level 3 will use this via: python -m vgc_bench.play "
              f"--reg {reg or '<reg>'} --level 3 --run_id {run_id}  (method auto)")
        return

    round_num = 0
    while forever or round_num < rounds:
        round_num += 1
        current = latest_timestep(results_path, AUTO_BATTLE_METHOD, reg, num_teams, run_id)
        target = current + steps_per_round
        print(
            f">> Auto Battle round {round_num}"
            f"{'' if forever else f'/{rounds}'}: self-play {current} -> {target} steps "
            f"(permanently training the Adaptive AI) ..."
        )
        subprocess.run(round_cmd(target), check=True)
        print(f"   checkpoints saved under {save_dir}")

    print("Auto Battle stopped. The Adaptive AI foundation has been extended.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Auto Battle: self-play that permanently trains the Adaptive AI."
    )
    parser.add_argument("--reg", type=str, default=None, help="VGC regulation, e.g. mb")
    parser.add_argument("--run_id", type=int, default=1, help="run/seed id")
    parser.add_argument("--num_teams", type=int, default=None, help="team count subfolder")
    parser.add_argument("--port", type=int, default=8000, help="showdown server port")
    parser.add_argument("--device", type=str, default="cuda:0", help="torch device")
    parser.add_argument(
        "--steps_per_round", type=int, default=983_040,
        help="self-play timesteps to add per round (default: one checkpoint interval).",
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--rounds", type=int, default=1, help="number of self-play rounds to run (default 1)."
    )
    group.add_argument(
        "--forever", action="store_true",
        help="keep battling round after round until stopped (permanent training).",
    )
    parser.add_argument(
        "--dry-run", dest="dry_run", action="store_true",
        help="print commands and resolved paths without training.",
    )
    args = parser.parse_args()
    reg = args.reg.lower() if args.reg is not None else None
    auto_battle(
        reg,
        args.run_id,
        args.num_teams,
        args.port,
        args.device,
        args.steps_per_round,
        args.rounds,
        args.forever,
        dry_run=args.dry_run,
    )

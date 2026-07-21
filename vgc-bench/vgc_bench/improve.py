"""
Adapt the Adaptive AI (Level 3) to how *you* play, on top of the Auto Battle
self-play foundation.

Level 3 is founded on Auto Battle -- self-play that permanently trains the base
policy (see ``vgc_bench/autobattle.py``, method ``bc_sp``). This script layers
your play on top of that foundation: it behavior-clones a model of your games,
freezes it as the exploiter's fixed opponent (``-1.zip``), and continues
training the foundation policy to beat it. The result (method ``ex``) is what
Level 3 plays.

It orchestrates the existing tested entry points; nothing here re-implements
training:

    (model of you)  logs2trajs -> pretrain
    (adaptation)    seed exploiter from the Auto Battle foundation + your model
                    -> train --exploiter

Run Auto Battle first to build/extend the foundation:

    python -m vgc_bench.autobattle --reg mb --forever      # permanent self-play
    python -m vgc_bench.improve   --reg mb                 # then adapt to your games

Requirements: a CUDA GPU, the ML extras (``pip install .[dev]``), and a running
pokemon-showdown server. Run from the repo root. Your games must already be in
``battle_logs/`` (capture them with ``play.py --save-logs``). ``--dry-run``
prints the commands and paths without executing (no GPU/deps needed).
"""

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from vgc_bench.autobattle import AUTO_BATTLE_METHOD
from vgc_bench.src.levels import method_save_dir, resolve_latest_checkpoint

# Method the adaptation (exploiter, seeded from the Auto Battle foundation)
# writes under. Level 3 (method "auto") prefers this over the raw foundation.
ADAPT_METHOD = "ex"


def _has_learner_checkpoint(save_dir: Path) -> bool:
    """True if a directory already holds a >=0 numbered checkpoint."""
    if not save_dir.is_dir():
        return False
    for p in save_dir.iterdir():
        if p.suffix == ".zip":
            try:
                if int(p.stem) >= 0:
                    return True
            except ValueError:
                continue
    return False


def _battle_logs_present(battle_logs_dir: Path) -> bool:
    """True if battle_logs/ holds at least one non-empty JSON log file."""
    if not battle_logs_dir.is_dir():
        return False
    for f in battle_logs_dir.iterdir():
        if f.suffix == ".json" and f.stat().st_size > 2:
            try:
                if json.loads(f.read_text()):
                    return True
            except (json.JSONDecodeError, OSError):
                continue
    return False


def improve(
    reg: str | None,
    run_id: int,
    num_teams: int | None,
    port: int,
    device: str,
    adapt_steps: int,
    num_workers: int,
    only_winner: bool,
    min_rating: int | None,
    num_epochs: int,
    results_path: str | Path = "results",
    dry_run: bool = False,
) -> None:
    """Adapt the Auto Battle foundation to the games in ``battle_logs/``."""
    py = sys.executable
    foundation_dir = method_save_dir(results_path, AUTO_BATTLE_METHOD, reg, num_teams, run_id)
    adapt_dir = method_save_dir(results_path, ADAPT_METHOD, reg, num_teams, run_id)

    def _reg_teams(cmd: list[str]) -> list[str]:
        if reg is not None:
            cmd += ["--reg", reg]
        if num_teams is not None:
            cmd += ["--num_teams", str(num_teams)]
        return cmd

    logs2trajs_cmd = [py, "-m", "vgc_bench.logs2trajs", "--num_workers", str(num_workers)]
    if only_winner:
        logs2trajs_cmd.append("--only_winner")
    if min_rating is not None:
        logs2trajs_cmd += ["--min_rating", str(min_rating)]
    pretrain_cmd = [
        py, "-m", "vgc_bench.pretrain",
        "--run_id", str(run_id), "--port", str(port),
        "--device", device, "--num_epochs", str(num_epochs),
    ]
    adapt_cmd = _reg_teams([
        py, "-m", "vgc_bench.train",
        "--exploiter",  # NOT --behavior_clone: we seed from the foundation instead
        "--run_id", str(run_id),
        "--total_steps", str(adapt_steps),
        "--port", str(port), "--device", device,
    ])

    if dry_run:
        print(f"[dry-run] Auto Battle foundation: {foundation_dir}")
        print(f"[dry-run] model of you : {' '.join(logs2trajs_cmd)}")
        print(f"[dry-run]              : {' '.join(pretrain_cmd)}")
        print(f"[dry-run] seed adapt dir {adapt_dir}: <foundation latest> -> 0.zip (if empty), <your model> -> -1.zip")
        print(f"[dry-run] adapt        : {' '.join(adapt_cmd)}")
        print(f"[dry-run] then: python -m vgc_bench.play --reg {reg or '<reg>'} "
              f"--level 3 --run_id {run_id}"
              + (f" --num_teams {num_teams}" if num_teams is not None else "")
              + "   (method auto picks this up)")
        return

    if not _has_learner_checkpoint(foundation_dir):
        raise SystemExit(
            "No Auto Battle foundation found at "
            f"{foundation_dir}. Build it first with:\n"
            f"  python -m vgc_bench.autobattle --reg {reg or '<reg>'} --forever"
        )
    if not _battle_logs_present(Path("battle_logs")):
        raise SystemExit(
            "No usable logs in battle_logs/. Capture games with "
            "`play.py --save-logs` (see the README) before adapting."
        )

    print(">> [1/3] Behavior-cloning a model of how you play ...")
    subprocess.run(logs2trajs_cmd, check=True)
    subprocess.run(pretrain_cmd, check=True)

    print(">> [2/3] Seeding the adaptation from the Auto Battle foundation + your model ...")
    foundation_ckpt = resolve_latest_checkpoint(results_path, AUTO_BATTLE_METHOD, reg, num_teams, run_id)
    user_model = resolve_latest_checkpoint(results_path, "bc", reg, None, run_id)
    adapt_dir.mkdir(parents=True, exist_ok=True)
    if not _has_learner_checkpoint(adapt_dir):
        shutil.copyfile(foundation_ckpt, adapt_dir / "0.zip")
        print(f"   foundation {foundation_ckpt} -> {adapt_dir / '0.zip'}")
    shutil.copyfile(user_model, adapt_dir / "-1.zip")
    print(f"   your model {user_model} -> {adapt_dir / '-1.zip'} (fixed opponent)")

    print(">> [3/3] Adapting the foundation to exploit your play ...")
    subprocess.run(adapt_cmd, check=True)

    latest = resolve_latest_checkpoint(results_path, ADAPT_METHOD, reg, num_teams, run_id)
    print(f"Done. New Level 3 checkpoint: {latest}")
    print(f"Play it: python -m vgc_bench.play --reg {reg or '<reg>'} --level 3 --run_id {run_id}"
          + (f" --num_teams {num_teams}" if num_teams is not None else "")
          + "   (method auto picks it up)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Adapt Level 3 to your games, on top of the Auto Battle foundation."
    )
    parser.add_argument("--reg", type=str, default=None, help="VGC regulation, e.g. mb")
    parser.add_argument("--run_id", type=int, default=1, help="run/seed id")
    parser.add_argument("--num_teams", type=int, default=None, help="team count subfolder")
    parser.add_argument("--port", type=int, default=8000, help="showdown server port")
    parser.add_argument("--device", type=str, default="cuda:0", help="torch device")
    parser.add_argument(
        "--adapt_steps", type=int, default=983_040,
        help="training timesteps for each adaptation pass against your model.",
    )
    parser.add_argument("--num_workers", type=int, default=1, help="log-parse workers")
    parser.add_argument("--only_winner", action="store_true", help="only learn from games you won")
    parser.add_argument("--min_rating", type=int, default=None, help="min Elo to include")
    parser.add_argument("--num_epochs", type=int, default=100, help="BC epochs")
    parser.add_argument(
        "--dry-run", dest="dry_run", action="store_true",
        help="print commands and resolved paths without running anything",
    )
    args = parser.parse_args()
    reg = args.reg.lower() if args.reg is not None else None
    improve(
        reg,
        args.run_id,
        args.num_teams,
        args.port,
        args.device,
        args.adapt_steps,
        args.num_workers,
        args.only_winner,
        args.min_rating,
        args.num_epochs,
        dry_run=args.dry_run,
    )

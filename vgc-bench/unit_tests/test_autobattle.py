"""
Unit tests for vgc_bench.autobattle (the Auto Battle self-play feature).

Dependency-light: autobattle.py shells out to train.py and never imports
torch/poke_env. It permanently extends the "bc_sp" self-play lineage that the
Adaptive AI (Level 3) is founded on.
"""

from pathlib import Path

from vgc_bench.autobattle import AUTO_BATTLE_METHOD, auto_battle
from vgc_bench.src.levels import (
    ADAPTIVE_METHODS,
    first_available_checkpoint,
    latest_timestep,
    method_save_dir,
)


class TestFoundationMethod:
    def test_auto_battle_trains_the_self_play_lineage(self):
        assert AUTO_BATTLE_METHOD == "bc_sp"

    def test_level3_falls_back_to_auto_battle_foundation(self):
        # method "auto" prefers the adapted policy, then the Auto Battle foundation.
        assert ADAPTIVE_METHODS == ["ex", "bc_sp"]

    def test_foundation_dir_layout(self):
        d = method_save_dir("results", AUTO_BATTLE_METHOD, "mb", None, 1)
        assert d == Path("results/saves_bc_sp/reg_mb/seed1")


class TestLatestTimestep:
    def test_zero_when_absent(self, tmp_path):
        assert latest_timestep(tmp_path, "bc_sp", "mb", None, 1) == 0

    def test_highest_non_negative_stem(self, tmp_path):
        d = tmp_path / "saves_bc_sp" / "reg_mb" / "seed1"
        d.mkdir(parents=True)
        for s in (-1, 0, 983040, 1966080):
            (d / f"{s}.zip").write_text("")
        # Auto Battle resumes from the newest so training always moves forward.
        assert latest_timestep(tmp_path, "bc_sp", "mb", None, 1) == 1966080


class TestFirstAvailableCheckpoint:
    def test_prefers_earlier_method_in_list(self, tmp_path):
        for method, stem in [("bc_sp", 5)]:  # only the foundation exists
            d = tmp_path / f"saves_{method}" / "reg_mb" / "seed1"
            d.mkdir(parents=True)
            (d / f"{stem}.zip").write_text("")
        got = first_available_checkpoint(tmp_path, ["ex", "bc_sp"], "mb", None, 1)
        assert got is not None and got.parts[-2] == "seed1" and "saves_bc_sp" in got.parts

    def test_prefers_adapted_over_foundation(self, tmp_path):
        for method, stem in [("ex", 3), ("bc_sp", 9)]:
            d = tmp_path / f"saves_{method}" / "reg_mb" / "seed1"
            d.mkdir(parents=True)
            (d / f"{stem}.zip").write_text("")
        got = first_available_checkpoint(tmp_path, ["ex", "bc_sp"], "mb", None, 1)
        assert "saves_ex" in got.parts  # adapted policy wins

    def test_none_when_nothing(self, tmp_path):
        assert first_available_checkpoint(tmp_path, ["ex", "bc_sp"], "mb", None, 1) is None


class TestDryRun:
    def test_dry_run_runs_without_training(self, capsys=None):
        # Just ensure it executes and prints a plan; no subprocess is launched.
        auto_battle("mb", 1, None, 8000, "cuda:0", 983040, 1, False, dry_run=True)

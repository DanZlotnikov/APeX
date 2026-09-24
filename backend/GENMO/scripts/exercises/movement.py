# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Movement-window wrapper, applied to every exercise's reps after counting (see analyze.py).

The counting engines mark a rep from the previous turning point of their signal, which can sit
seconds before the movement: in the ready stance, while stepping, or while talking. This trims each
rep to the movement itself, per exercise (ExerciseDefinition.movement_rule): a rep's movement runs
between the rests on either side of its peak activity, where "rest" means activity stays below a
fraction of that rep's own peak for a minimum time. Anything outside every rep's window (setup,
explaining, gesturing before the first rep) is then outside all metrics.

The rule can also confirm the movement really is the exercise; a rep that fails is dropped.
"""
from __future__ import annotations

import numpy as np

from .definitions import MovementRule


def _activity(rule: MovementRule, signals: dict, times: np.ndarray) -> np.ndarray:
    sig = np.asarray(signals[rule.activity_signal], dtype=float)
    if rule.activity_is_rate:
        return np.abs(sig)
    return np.abs(np.gradient(sig, times)) if len(sig) > 1 else np.zeros_like(sig)


def _rest_runs(rest: np.ndarray, times: np.ndarray, min_sec: float) -> list[tuple[int, int]]:
    """[first, last] frame index of every rest stretch lasting at least min_sec."""
    runs, i, n = [], 0, len(rest)
    dt = float(np.median(np.diff(times))) if n > 1 else 0.0
    while i < n:
        if not rest[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and rest[j + 1]:
            j += 1
        if times[j] - times[i] + dt >= min_sec:
            runs.append((i, j))
        i = j + 1
    return runs


def _trim(rep: dict, activity: np.ndarray, times: np.ndarray, rule: MovementRule) -> dict:
    lo, hi = rep["start"], rep["end"]
    if hi <= lo:
        return dict(rep)
    peak = lo + int(np.argmax(activity[lo:hi + 1]))
    runs = _rest_runs(activity < rule.rest_fraction * activity[peak], times, rule.min_rest_sec)
    start = max([b + 1 for _, b in runs if b < peak], default=lo)
    end = min([a - 1 for a, _ in runs if a > peak], default=hi)
    start, end = max(start, lo), min(end, hi)
    # The rep's own marked extreme (e.g. a stroke's follow-through) always stays inside.
    return {**rep, "start": min(start, rep["bottom"]), "end": max(end, rep["bottom"])}


def apply_movement_rule(defn, reps: list[dict], signals: dict, times: np.ndarray) -> list[dict]:
    rule = defn.movement_rule
    if rule is None or not rule.active or not reps:
        return reps
    activity = _activity(rule, signals, times)
    kept = []
    for rep in reps:
        r = _trim(rep, activity, times, rule)
        if rule.confirm_signals:
            window = slice(r["start"], r["end"] + 1)
            reach = max(float(np.ptp(signals[name][window])) for name in rule.confirm_signals)
            if reach < rule.confirm_min:
                continue
        kept.append(r)
    return kept

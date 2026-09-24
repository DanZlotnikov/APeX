# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Movement-window wrapper, applied to every exercise's reps after counting (see analyze.py).

The counting engines mark a rep from the previous turning point of their signal, which can sit
seconds before the movement: in the ready stance, while stepping, or while talking. This trims each
rep to the movement itself, per exercise (ExerciseDefinition.movement_rule): a rep's movement runs
between the rests on either side of its peak activity, where "rest" means activity stays below a
fraction of that rep's own peak for a minimum time. Anything outside every rep's window (setup,
explaining, gesturing before the first rep) is then outside all metrics.

With window_from_rests the rule builds the windows itself from each rep's activity peak (bounded by
the quietest moment between neighbouring reps, so windows never overlap), and it can move the rep's
marked position (peak_position_signal). The rule can also confirm the movement really is the
exercise; a rep that fails is dropped.
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


def _window(peak: int, lo: int, hi: int, activity: np.ndarray, times: np.ndarray, rule: MovementRule) -> tuple[int, int]:
    """Movement start/end around `peak`, kept within [lo, hi]."""
    runs = _rest_runs(activity < rule.rest_fraction * activity[peak], times, rule.min_rest_sec)
    start = max([b + 1 for _, b in runs if b < peak], default=lo)
    end = min([a - 1 for a, _ in runs if a > peak], default=hi)
    return max(start, lo), min(end, hi)


def apply_movement_rule(defn, reps: list[dict], signals: dict, times: np.ndarray) -> list[dict]:
    rule = defn.movement_rule
    if rule is None or not rule.active or not reps:
        return reps
    activity = _activity(rule, signals, times)
    peaks = [r["start"] + int(np.argmax(activity[r["start"]:r["end"] + 1])) for r in reps]
    kept = []
    for k, rep in enumerate(reps):
        peak = peaks[k]
        if rule.window_from_rests:
            # Bounded by the quietest frame between this rep's peak and each neighbour's.
            lo = 0 if k == 0 else peaks[k - 1] + int(np.argmin(activity[peaks[k - 1]:peak + 1]))
            hi = len(activity) - 1 if k == len(reps) - 1 else peak + int(np.argmin(activity[peak:peaks[k + 1] + 1]))
            start, end = _window(peak, lo, hi, activity, times, rule)
            bottom = peak
            if rule.peak_position_signal:
                bottom = peak + int(np.argmax(np.asarray(signals[rule.peak_position_signal])[peak:end + 1]))
        else:
            start, end = _window(peak, rep["start"], rep["end"], activity, times, rule)
            bottom = rep["bottom"]
        # The rep's marked position always stays inside its window.
        r = {**rep, "start": min(start, bottom), "bottom": bottom, "end": max(end, bottom)}
        if rule.confirm_signals:
            window = slice(r["start"], r["end"] + 1)
            reach = max(float(np.ptp(signals[name][window])) for name in rule.confirm_signals)
            if reach < rule.confirm_min:
                continue
        kept.append(r)
    return kept

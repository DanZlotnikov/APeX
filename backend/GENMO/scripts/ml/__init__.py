# SPDX-License-Identifier: LicenseRef-NVIDIA-OneWay-Noncommercial
"""
Training pipeline for the ML exercise classifier — a second, independent
"what exercise was that?" signal computed alongside the rule-based
exercises/analyze.py pipeline. See scripts/exercises/ml_classifier.py for
the inference side that actually plugs into worker.py.

Run order: download_pennaction.py -> extract_features.py -> train_classifier.py.
"""

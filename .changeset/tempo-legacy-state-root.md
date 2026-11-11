---
"prool": patch
---

Fixed Tempo instances failing to start on current Tempo nodes, such as `ghcr.io/tempoxyz/tempo:latest`, by no longer passing `--engine.legacy-state-root`. Tempo removed the flag, which had no effect since Tempo 1.11. To keep it on an older node, pass `engine: { legacyStateRoot: true }`.

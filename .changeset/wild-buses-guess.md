---
'prool': patch
---

Made the testcontainers Tempo instance startup timeout configurable via `startupTimeout`. This also introduces a shared internal container-options shape for testcontainers-backed instances, so future container adapters can reuse the same option pattern. The default timeout remains `10_000ms`.

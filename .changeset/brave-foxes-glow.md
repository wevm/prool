---
'prool': patch
---

Fixed testcontainers Tempo instance to use exposed ports instead of host networking for macOS compatibility. Containers now bind to `127.0.0.1` with dynamically mapped ports, resolving connectivity issues on non-Linux platforms.

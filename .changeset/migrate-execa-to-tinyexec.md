---
'prool': patch
---

Migrated the internal process backend from `execa` to `tinyexec`. The public callback shape `($) => $\`cmd ${args}\`` is unchanged, including the callable form `$({ env })\`...\``. Removed 16 transitive dependencies.

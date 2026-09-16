---
"prool": patch
---

Added a Tempo `hardfork` option that activates the selected fork and earlier forks at genesis while disabling later forks for binary and container instances.

```ts
import { Instance } from 'prool'

const instance = Instance.tempo({ hardfork: 'T10' })
await instance.start()
```

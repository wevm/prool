---
'prool': patch
---

Added `Sweep.compose` to `prool/testcontainers` for removing Compose containers and networks orphaned by interrupted runs.

```ts
import { Sweep } from 'prool/testcontainers'

await Sweep.compose({ composeFile: 'test/compose.yaml' })
```

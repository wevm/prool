---
'prool': patch
---

Added named instances to Vitest server and pool setup with worker isolation and independent server lifecycle controls.

```ts
import { Instance } from 'prool'
import { Server } from 'prool/vitest'

export default Server.setup({
  instances: { l1: Instance.anvil(), l2: Instance.anvil() },
  setup(chains, project) {
    project.provide('chains', chains)
  },
})
```

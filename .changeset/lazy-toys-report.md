---
"prool": minor
---

**Breaking:** Refactored to use namespace imports.

### Imports

```diff
- import { createServer } from 'prool'
- import { anvil, alto, rundler } from 'prool/instances'
- import { defineInstance } from 'prool'
- import { definePool } from 'prool'
+ import { Instance, Pool, Server } from 'prool'
```

### `Server.create` → `Server.create`

```diff
- const server = createServer({
-   instance: anvil(),
+ const server = Server.create({
+   instance: Instance.anvil(),
  })
```

### `anvil`, `alto`, `rundler` → `Instance.anvil`, `Instance.alto`, `Instance.rundler`

```diff
- const instance = anvil({ ... })
+ const instance = Instance.anvil({ ... })

- const instance = alto({ ... })
+ const instance = Instance.alto({ ... })

- const instance = rundler({ ... })
+ const instance = Instance.rundler({ ... })
```

### `defineInstance` → `Instance.define`

```diff
- const foo = defineInstance((parameters) => {
+ const foo = Instance.define((parameters) => {
    return {
      name: 'foo',
      // ...
    }
  })
```

### `definePool` → `Pool.define`

```diff
- const pool = definePool({
-   instance: anvil(),
+ const pool = Pool.define({
+   instance: Instance.anvil(),
  })
```

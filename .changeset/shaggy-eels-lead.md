---
"prool": minor
---

**Breaking:** Moved `Instance.tempoDocker` into `prool/testcontainers` entrypoint.

```diff
- import { Instance } from 'prool'
+ import { Instance } from 'prool/testcontainers'

- Instance.tempoDocker
+ Instance.tempo
```

---
'prool': minor
---

Added typed named endpoints, Server discovery, and generic Testcontainers-backed instances.

```ts
import { Instance } from 'prool/testcontainers'
import { GenericContainer } from 'testcontainers'

const service = Instance.testcontainer({
  name: 'service',
  container: () => new GenericContainer('service:latest'),
  endpoints: {
    default: { protocol: 'http', port: 8080 },
    metrics: { protocol: 'http', port: 9090 },
  },
})

await service.start()
service.endpoints.metrics
```

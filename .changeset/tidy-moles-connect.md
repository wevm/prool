---
'prool': minor
---

Added typed named endpoints, Server discovery, and generic Testcontainers-backed instances.

```ts
import { Instance } from 'prool/testcontainers'
import { GenericContainer } from 'testcontainers'

const service = Instance.testcontainer({
  name: 'service',
  container: () =>
    new GenericContainer('service:latest').withExposedPorts(8080, 9090),
  endpoints: {
    default: { protocol: 'http', containerPort: 8080 },
    metrics: { protocol: 'http', containerPort: 9090 },
  },
})

await service.start()
service.endpoint('metrics')
```

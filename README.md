# prool

HTTP Proxy Pools.

```ts
import { createServer } from 'prool'
import { anvil } from 'prool/instances'

const server = createServer({
  instance: anvil(),
})

await server.start() 
// Instances accessible at:
// "http://localhost:8545/1"
// "http://localhost:8545/2"
// "http://localhost:8545/3"
// "http://localhost:8545/n"
```

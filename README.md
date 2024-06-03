# prool

HTTP Proxy Pools.

```ts
import { defineProxyPool } from 'prool'
import { anvil } from 'prool/instances'

const server = defineProxyPool({
  instance: anvil({ 
    forkRpcUrl: 'https://cloudflare-eth.com'
  }),
})

await server.start() 
// Instances accessible at:
// "http://localhost:8545/1"
// "http://localhost:8545/2"
// "http://localhost:8545/3"
// "http://localhost:8545/n"
```

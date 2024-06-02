# prool

HTTP & WebSocket Proxy Pools.

```ts
import { defineProol } from 'prool'
import { alto, anvil } from 'prool/instances'

const executionPool = defineProol({
  instance: anvil({ 
    // ...
    forkRpcUrl: 'https://cloudflare-eth.com'
  }),
  port: 8545,
})

await executionPool.start() 
// Instances started at:
// "http://localhost:8545/1"
// "http://localhost:8545/2"
// "http://localhost:8545/3"
// "http://localhost:8545/n"

const bundlerPool = defineProol({
  instance: ({ id }) => alto({
    // ...
    executionRpcUrl: `${executionPool.hostname}/${id}`
  }),
  port: 4337,
})

await bundlerPool.start() 
// Instances started at:
// "http://localhost:4337/1" (executionRpcUrl: "http://localhost:8545/1")
// "http://localhost:4337/2" (executionRpcUrl: "http://localhost:8545/2")
// "http://localhost:4337/3" (executionRpcUrl: "http://localhost:8545/3")
// "http://localhost:4337/n" (executionRpcUrl: "http://localhost:8545/n")

const indexerPool = defineProol({
  instance: ({ id }) => ponder({
    // ...
    executionRpcUrl: `${executionPool.hostname}/${id}`
  }),
  port: 1337,
})

await indexerPool.start() 
// Instances started at:
// "http://localhost:1337/1" (executionRpcUrl: "http://localhost:8545/1")
// "http://localhost:1337/2" (executionRpcUrl: "http://localhost:8545/2")
// "http://localhost:1337/3" (executionRpcUrl: "http://localhost:8545/3")
// "http://localhost:1337/n" (executionRpcUrl: "http://localhost:8545/n")
```

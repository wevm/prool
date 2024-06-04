<br/>

<p align="center">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://github.com/wevm/prool/blob/main/.github/prool-dark.svg">
      <img alt="mipd logo" src="https://github.com/wevm/prool/blob/main/.github/prool-light.svg" width="auto" height="100">
    </picture>
</p>

<p align="center">
  HTTP testing instances for Ethereum</a>
<p>

## Usage

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

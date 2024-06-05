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

## Introduction

Prool is a library that provides programmatic HTTP testing instances for Ethereum. It is designed to be used in testing environments (e.g. [Vitest](https://vitest.dev/)) where you need to interact with an Ethereum server instance (e.g. Execution Node, 4337 Bundler, Indexer, etc) over HTTP or WebSocket.

Prool contains a set of pre-configured instances that can be used to simulate Ethereum server environments, being:

- **Local Execution Nodes:** [`anvil`](#TODO)
- **Bundler Nodes:** `alto`⚠️, `rundler`⚠️, `silius`⚠️, [`stackup`](#TODO)
- **Indexer Nodes:** `ponder`⚠️

⚠️ = soon

You can also create your own custom instances by using the [`defineInstance` function](#TODO).

## Install

```bash
npm i prool
```

```bash
pnpm add prool
```

```bash
bun i prool
```

## Usage

### Anvil (Execution Node)

> [!WARNING]
> This instance requires [Anvil](https://getfoundry.sh/) to be installed on your machine.

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

### Stackup (Bundler Node)

> [!WARNING]
> This instance requires [Docker](https://docs.docker.com/get-docker/) to be installed on your machine.

```ts
import { createServer } from 'prool'
import { anvil, stackup } from 'prool/instances'

const executionServer = createServer({
  instance: anvil(),
  port: 8545
})
await executionServer.start() 
// Instances accessible at:
// "http://localhost:8545/1"
// "http://localhost:8545/2"
// "http://localhost:8545/3"
// "http://localhost:8545/n"

const bundlerServer = createServer({
  instance: (key) => stackup({
    ethClientUrl: `http://localhost:8545/${key}`,
    privateKey: '0x...',
  })
})
// Instances accessible at:
// "http://localhost:4337/1" (→ http://localhost:8545/1)
// "http://localhost:4337/2" (→ http://localhost:8545/2)
// "http://localhost:4337/3" (→ http://localhost:8545/3)
// "http://localhost:4337/n" (→ http://localhost:8545/n)
```

## Authors

- [@jxom](https://github.com/jxom) (jxom.eth, [Twitter](https://twitter.com/jakemoxey))
- [@tmm](https://github.com/tmm) (awkweb.eth, [Twitter](https://twitter.com/awkweb))

## License

[MIT](/LICENSE) License
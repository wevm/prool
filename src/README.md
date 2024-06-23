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

<p align="center">
  <a href="https://www.npmjs.com/package/prool">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/npm/v/prool?colorA=21262d&colorB=21262d&style=flat">
      <img src="https://img.shields.io/npm/v/prool?colorA=f6f8fa&colorB=f6f8fa&style=flat" alt="Version">
    </picture>
  </a>
  <a href="https://github.com/wevm/prool/blob/main/LICENSE">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/npm/l/prool?colorA=21262d&colorB=21262d&style=flat">
      <img src="https://img.shields.io/npm/l/prool?colorA=f6f8fa&colorB=f6f8fa&style=flat" alt="MIT License">
    </picture>
  </a>
  <a href="https://www.npmjs.com/package/prool">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/npm/dm/prool?colorA=21262d&colorB=21262d&style=flat">
      <img src="https://img.shields.io/npm/dm/prool?colorA=f6f8fa&colorB=f6f8fa&style=flat" alt="Downloads per month">
    </picture>
  </a>
</p>

## Introduction

Prool is a library that provides programmatic HTTP testing instances for Ethereum. It is designed to be used in testing environments (e.g. [Vitest](https://vitest.dev/)) where you need to interact with an Ethereum server instance (e.g. Execution Node, 4337 Bundler, Indexer, etc) over HTTP or WebSocket.

Prool contains a set of pre-configured instances that can be used to simulate Ethereum server environments, being:

- **Local Execution Nodes:** [`anvil`](#anvil-execution-node)
- **Bundler Nodes:** [`alto`](#alto-bundler-node), [`rundler`](#rundler-bundler-node), [`silius`](#silius-bundler-node), [`stackup`](#stackup-bundler-node)
- **Indexer Nodes:** `ponder`⚠️

⚠️ = soon

You can also create your own custom instances by using the [`defineInstance` function](#defineinstance).

## Table of Contents

- [Install](#install)
- [Getting Started](#getting-started)
  - [Anvil (Execution Node)](#anvil-execution-node)
  - [Alto (Bundler Node)](#alto-bundler-node)
  - [Rundler (Bundler Node)](#rundler-bundler-node)
  - [Silius (Bundler Node)](#silius-bundler-node)
  - [Stackup (Bundler Node)](#stackup-bundler-node)
- [Reference](#reference)
  - [`createServer`](#createserver)
  - [`defineInstance`](#defineinstance)
  - [`definePool`](#definepool)


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

## Getting Started

### Anvil (Execution Node)

#### Requirements

- [Foundry](https://getfoundry.sh/) binary installed
  - Download: `curl -L https://foundry.paradigm.xyz | bash`

#### Usage

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

#### Parameters

See [`AnvilParameters`](https://github.com/wevm/prool/blob/801ede06ded8b2cb2d59c95294aae795e548897c/src/instances/anvil.ts#L5).

### Alto (Bundler Node)

#### Requirements

- [`@pimlico/alto`](npm.im/@pimlico/alto): `npm i @pimlico/alto`

#### Usage

```ts
import { createServer } from 'prool'
import { anvil, alto } from 'prool/instances'

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
  instance: (key) => alto({
    entrypoints: ['0x0000000071727De22E5E9d8BAf0edAc6f37da032'],
    rpcUrl: `http://localhost:8545/${key}`,
    executorPrivateKeys: ['0x...'],
  })
})
await bundlerServer.start()
// Instances accessible at:
// "http://localhost:3000/1" (→ http://localhost:8545/1)
// "http://localhost:3000/2" (→ http://localhost:8545/2)
// "http://localhost:3000/3" (→ http://localhost:8545/3)
// "http://localhost:3000/n" (→ http://localhost:8545/n)
```

#### Parameters

See [`AltoParameters`](https://github.com/wevm/prool/blob/801ede06ded8b2cb2d59c95294aae795e548897c/src/instances/alto.ts#L7).

### Rundler (Bundler Node)

#### Requirements

- [Rundler](https://github.com/alchemyplatform/rundler) binary installed
  - [Download](https://github.com/alchemyplatform/rundler/releases)

#### Usage

```ts
import { createServer } from 'prool'
import { anvil, rundler } from 'prool/instances'

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
  instance: (key) => rundler({
    nodeHttp: `http://localhost:8545/${key}`,
  })
})
await bundlerServer.start()
// Instances accessible at:
// "http://localhost:3000/1" (→ http://localhost:8545/1)
// "http://localhost:3000/2" (→ http://localhost:8545/2)
// "http://localhost:3000/3" (→ http://localhost:8545/3)
// "http://localhost:3000/n" (→ http://localhost:8545/n)
```

#### Parameters

See [RundlerParameters]().

### Silius (Bundler Node)

#### Requirements

- [Docker](https://docs.docker.com/get-docker/)
- Silius Docker Image: `docker pull silius-rs/silius`

#### Usage

```ts
import { createServer } from 'prool'
import { anvil, silius } from 'prool/instances'

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
  instance: (key) => silius({
    ethClientAddress: `http://localhost:8545/${key}`,
    mnemonicPath: './keys/0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  })
})
await bundlerServer.start()
// Instances accessible at:
// "http://localhost:4000/1" (→ http://localhost:8545/1)
// "http://localhost:4000/2" (→ http://localhost:8545/2)
// "http://localhost:4000/3" (→ http://localhost:8545/3)
// "http://localhost:4000/n" (→ http://localhost:8545/n)
```

#### Parameters

See [`SiliusParameters`]().

### Stackup (Bundler Node)

#### Requirements

- [Docker](https://docs.docker.com/get-docker/)
- Stackup Docker Image: `docker pull stackupwallet/stackup-bundler:latest`

#### Usage

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
await bundlerServer.start()
// Instances accessible at:
// "http://localhost:4337/1" (→ http://localhost:8545/1)
// "http://localhost:4337/2" (→ http://localhost:8545/2)
// "http://localhost:4337/3" (→ http://localhost:8545/3)
// "http://localhost:4337/n" (→ http://localhost:8545/n)
```

#### Parameters

See [`StackupParameters`](https://github.com/wevm/prool/blob/801ede06ded8b2cb2d59c95294aae795e548897c/src/instances/stackup.ts#L5).

## Reference

### `createServer`

Creates a server that manages a pool of instances via a proxy.

#### Usage

```ts
import { createServer } from 'prool'
import { anvil } from 'prool/instances'

const executionServer = createServer({
  instance: anvil(),
})
await executionServer.start() 
// Instances accessible at:
// "http://localhost:8545/1"
// "http://localhost:8545/2"
// "http://localhost:8545/3"
// "http://localhost:8545/n"
// "http://localhost:8545/n/start"
// "http://localhost:8545/n/stop"
// "http://localhost:8545/n/restart"
// "http://localhost:8545/healthcheck"
```

**Endpoints:**
- `/:key`: Proxy to instance at `key`. 
- `/:key/start`: Start instance at `key`.
- `/:key/stop`: Stop instance at `key`.
- `/:key/restart`: Restart instance at `key`.
- `/healthcheck`: Healthcheck endpoint.

#### API

| Name       | Description                                              | Type                                    |
| ---------- | -------------------------------------------------------- | --------------------------------------- |
| `instance` | Instance for the server.                                 | `Instance \| (key: number) => Instance` |
| `limit`    | Number of instances that can be instantiated in the pool | `number`                                |
| `host`     | Host for the server.                                     | `string`                                |
| `port`     | Port for the server.                                     | `number`                                |
| returns    | Server                                                   | `CreateServerReturnType`                |

### `defineInstance`

Creates an instance definition, that can be used with [`createServer`](#createserver) or [`definePool`](#definepool).

#### Usage

```ts
import { defineInstance } from 'prool'

const foo = defineInstance((parameters: FooParameters) => {
 return {
   name: 'foo',
   host: 'localhost',
   port: 3000,
   async start() {
     // ...
   },
   async stop() {
     // ...
   },
 }
})
```

#### API

| Name    | Description          | Type               |
| ------- | -------------------- | ------------------ |
| `fn`    | Instance definition. | `DefineInstanceFn` |
| returns | Instance.            | `Instance`         |

### `definePool`

Defines a pool of instances. Instances can be started, cached, and stopped against an identifier.

#### Usage

```ts
import { definePool } from 'prool'
import { anvil } from 'prool/instances'

const pool = definePool({
 instance: anvil(),
})
const instance_1 = await pool.start(1)
const instance_2 = await pool.start(2)
const instance_3 = await pool.start(3)
```

#### API

| Name       | Description                                              | Type       |
| ---------- | -------------------------------------------------------- | ---------- |
| `instance` | Instance for the pool.                                   | `Instance` |
| `limit`    | Number of instances that can be instantiated in the pool | `number`   |
| returns    | Pool.                                                    | `Pool`     |

## Authors

- [@jxom](https://github.com/jxom) (jxom.eth, [Twitter](https://twitter.com/jakemoxey))
- [@tmm](https://github.com/tmm) (awkweb.eth, [Twitter](https://twitter.com/awkweb))

## License

[MIT](/LICENSE) License

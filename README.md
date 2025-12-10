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

- **Local Execution Nodes:** [`anvil`](#anvil-execution-node), [`tempo`](#tempo-execution-node)
- **ERC-4337 Bundler Nodes:** [`alto`](#alto-bundler-node)

You can also create your own custom instances by using the [`Instance.define` function](#instancedefine).

## Table of Contents

- [Install](#install)
- [Getting Started](#getting-started)
  - [Anvil (Execution Node)](#anvil-execution-node)
  - [Alto (ERC-4337 Bundler Node)](#alto-bundler-node)
- [Reference](#reference)
  - [`Server.create`](#servercreate)
  - [`Instance.define`](#instancedefine)
  - [`Pool.define`](#pooldefine)


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

```bash
curl -L https://foundry.paradigm.xyz | bash   # Install Foundry
```

#### Usage

```ts
import { Instance, Server } from 'prool'

const server = Server.create({
  instance: Instance.anvil(),
})

await server.start() 
// Instances accessible at:
// "http://localhost:8545/1"
// "http://localhost:8545/2"
// "http://localhost:8545/3"
// "http://localhost:8545/n"
```

### Tempo (Execution Node)

#### Requirements

```bash
curl -L https://get.docker.com/ | bash    # Install Docker
npm i testcontainers                      # Install `testcontainers`
```

#### Usage

```ts
import { Instance, Server } from 'prool'

const server = Server.create({
  instance: Instance.tempo(),
})

await server.start() 
// Instances accessible at:
// "http://localhost:8545/1"
// "http://localhost:8545/2"
// "http://localhost:8545/3"
// "http://localhost:8545/n"
```

### Alto (Bundler Node)

#### Requirements

- [`@pimlico/alto`](npm.im/@pimlico/alto): `npm i @pimlico/alto`

#### Usage

```ts
import { Instance, Server } from 'prool'

const executionServer = Server.create({
  instance: Instance.anvil(),
  port: 8545
})
await executionServer.start() 
// Instances accessible at:
// "http://localhost:8545/1"
// "http://localhost:8545/2"
// "http://localhost:8545/3"
// "http://localhost:8545/n"

const bundlerServer = Server.create({
  instance: (key) => Instance.alto({
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

## Reference

### `Server.create`

Creates a server that manages a pool of instances via a proxy.

#### Usage

```ts
import { Instance, Server } from 'prool'

const executionServer = Server.create({
  instance: Instance.anvil(),
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
| returns    | Server                                                   | `Server.Server`                         |

### `Instance.define`

Creates an instance definition, that can be used with [`Server.create`](#servercreate) or [`Pool.define`](#pooldefine).

#### Usage

```ts
import { Instance } from 'prool'

const foo = Instance.define((parameters: FooParameters) => {
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

### `Pool.define`

Defines a pool of instances. Instances can be started, cached, and stopped against an identifier.

#### Usage

```ts
import { Instance, Pool } from 'prool'

const pool = Pool.define({
 instance: Instance.anvil(),
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
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

Prool contains a set of pre-configured instances that can be used to simulate Ethereum server environments, such as:

- [`anvil`](#TODO): A local Ethereum execution node.

You can also create your own custom instances by using the [`defineInstance` function](#TODO).

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

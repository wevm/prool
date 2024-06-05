import { EventEmitter } from 'eventemitter3'
import { afterEach, expect, test } from 'vitest'
import { type ExecaProcess, execa } from './execa.js'

const processes: ExecaProcess[] = []
function createProcess() {
  const process = execa({ name: 'foo' })
  processes.push(process)
  return process
}

afterEach(async () => {
  for (const process of processes) await process.stop().catch(() => {})
})

test('default', async () => {
  const process = createProcess()
  expect(process).toMatchInlineSnapshot(`
    {
      "_internal": {
        "process": undefined,
      },
      "name": "foo",
      "start": [Function],
      "stop": [Function],
    }
  `)
})

test('start', async () => {
  const emitter = new EventEmitter<any>()
  const process = createProcess()

  const resolvers = {
    listening: Promise.withResolvers<void>(),
    message: Promise.withResolvers<void>(),
    stdout: Promise.withResolvers<void>(),
  }
  emitter.on('listening', resolvers.listening.resolve)
  emitter.on('message', resolvers.message.resolve)
  emitter.on('stdout', resolvers.stdout.resolve)

  await process.start(($) => $`anvil --port 1337`, {
    emitter,
    status: 'idle',
    resolver({ process, resolve }) {
      process.stdout.on('data', (data) => {
        const message = data.toString()
        if (message.includes('Listening on')) resolve()
      })
    },
  })
  expect(process._internal.process).toBeDefined()
  await expect(resolvers.listening.promise).resolves.toBeUndefined()
  await expect(resolvers.message.promise).resolves.toBeDefined()
  await expect(resolvers.stdout.promise).resolves.toBeDefined()
})

test('start (error)', async () => {
  const emitter = new EventEmitter<any>()
  const process = createProcess()

  const resolvers = {
    listening: Promise.withResolvers<void>(),
    message: Promise.withResolvers<void>(),
    stderr: Promise.withResolvers<void>(),
  }
  emitter.on('listening', resolvers.listening.resolve)
  emitter.on('message', resolvers.message.resolve)
  emitter.on('stderr', resolvers.stderr.resolve)

  // Invalid argument
  await expect(() =>
    process.start(($) => $`anvil --lol`, {
      emitter,
      status: 'idle',
      resolver({ process, reject, resolve }) {
        process.stdout.on('data', (data) => {
          const message = data.toString()
          if (message.includes('Listening on')) resolve()
        })
        process.stderr.on('data', reject)
      },
    }),
  ).rejects.toThrowErrorMatchingInlineSnapshot(`
    [Error: Failed to start process "foo": error: unexpected argument '--lol' found

    Usage: anvil [OPTIONS] [COMMAND]

    For more information, try '--help'.
    ]
  `)
  await expect(resolvers.message.promise).resolves.toBeDefined()
  await expect(resolvers.stderr.promise).resolves.toBeDefined()
})

test('behavior: exit', async () => {
  const emitter = new EventEmitter<any>()
  const process = createProcess()

  const resolvers = {
    exit: Promise.withResolvers<void>(),
  }
  emitter.on('exit', resolvers.exit.resolve)

  // Invalid argument
  await process.start(($) => $`anvil --port 1338`, {
    emitter,
    status: 'idle',
    resolver({ process, resolve }) {
      process.stdout.on('data', (data) => {
        const message = data.toString()
        if (message.includes('Listening on')) resolve()
      })
    },
  })
  process._internal.process.kill()
  await expect(resolvers.exit.promise).resolves.toBeDefined()
})

test('behavior: exit when status is starting', async () => {
  const emitter = new EventEmitter<any>()
  const process = createProcess()

  const resolvers = {
    exit: Promise.withResolvers<void>(),
  }
  emitter.on('exit', resolvers.exit.resolve)

  // Invalid argument
  await process.start(($) => $`anvil`, {
    emitter,
    status: 'starting',
    resolver({ process, resolve }) {
      process.stdout.on('data', (data) => {
        const message = data.toString()
        if (message.includes('Listening on')) resolve()
      })
    },
  })
  process._internal.process.kill()
  await expect(resolvers.exit.promise).resolves.toBeDefined()
})

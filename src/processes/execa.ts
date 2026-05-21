import type { ChildProcess, SpawnOptions } from 'node:child_process'
import type { SignalConstants } from 'node:os'
import type { Readable } from 'node:stream'
import { x } from 'tinyexec'
import type * as Instance from '../Instance.js'
import { stripColors } from '../internal/utils.js'

export type Process_internal = ChildProcess & {
  stdout: Readable
  stderr: Readable
}

export type ExecaStartOptions =
  Instance.define.InstanceStartOptions_internal & {
    resolver(options: {
      process: Process_internal
      reject(data: string): Promise<void>
      resolve(): void
    }): void
  }

type TagOptions = { env?: Record<string, string> }
type Tag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Process_internal

// Assumes `toArgs` produces unquoted `string[]` tokens: array interpolations
// are spread as separate argv items; static segments are whitespace-split.
function buildTag(options: TagOptions = {}): Tag {
  return (strings, ...values) => {
    const argv: string[] = []
    let buffer = ''
    const flush = () => {
      const trimmed = buffer.trim()
      if (trimmed) for (const token of trimmed.split(/\s+/)) argv.push(token)
      buffer = ''
    }
    for (let i = 0; i < strings.length; i++) {
      buffer += strings[i]
      if (i < values.length) {
        const value = values[i]
        if (Array.isArray(value)) {
          flush()
          for (const element of value) argv.push(String(element))
        } else {
          buffer += String(value)
        }
      }
    }
    flush()
    const [command, ...args] = argv
    const nodeOptions: SpawnOptions = options.env
      ? { env: { ...process.env, ...options.env } as NodeJS.ProcessEnv }
      : {}
    // `x()` spawns synchronously, so `.process` is defined here.
    return x(command!, args, { nodeOptions }).process as Process_internal
  }
}

type DualShape = {
  (options: TagOptions): Tag
  (strings: TemplateStringsArray, ...values: unknown[]): Process_internal
}

function isTemplateStringsArray(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && 'raw' in value
}

const $: DualShape = ((
  arg: TemplateStringsArray | TagOptions,
  ...values: unknown[]
): Process_internal | Tag => {
  if (isTemplateStringsArray(arg)) return buildTag()(arg, ...values)
  return buildTag(arg)
}) as DualShape

export type Process = {
  _internal: {
    process: Process_internal
  }
  name: string
  start(
    command: (tag: DualShape) => Process_internal,
    options: ExecaStartOptions,
  ): Promise<void>
  stop(signal?: keyof SignalConstants | number): Promise<void>
}

export function execa(parameters: execa.Parameters): execa.ReturnType {
  const { name } = parameters

  const errorMessages: string[] = []
  let proc: Process_internal

  async function stop(signal?: keyof SignalConstants | number) {
    const killed = proc.kill(signal)
    if (!killed) return
    return new Promise((resolve) => proc.on('close', resolve))
  }

  return {
    _internal: {
      get process() {
        return proc
      },
    },
    name,
    start(command, { emitter, resolver, status }) {
      const { promise, resolve, reject } = Promise.withResolvers<void>()

      proc = command($)

      resolver({
        process: proc,
        async reject(data) {
          await stop()
          reject(
            new Error(`Failed to start process "${name}": ${data.toString()}`),
          )
        },
        resolve() {
          emitter.emit('listening')
          return resolve()
        },
      })

      proc.stdout.on('data', (data) => {
        const message = stripColors(data.toString())
        emitter.emit('message', message)
        emitter.emit('stdout', message)
      })
      proc.stderr.on('data', async (data) => {
        const message = stripColors(data.toString())

        errorMessages.push(message)
        if (errorMessages.length > 20) errorMessages.shift()

        emitter.emit('message', message)
        emitter.emit('stderr', message)
      })
      proc.on('close', () => proc.removeAllListeners())
      proc.on('exit', (code, signal) => {
        emitter.emit('exit', code, signal)

        if (!code) {
          proc.removeAllListeners()
          if (status === 'starting')
            reject(
              new Error(
                `Failed to start process "${name}": ${
                  errorMessages.length > 0
                    ? `\n\n${errorMessages.join('\n')}`
                    : 'exited'
                }`,
              ),
            )
        }
      })

      return promise
    },
    async stop() {
      proc.removeAllListeners()
      await stop()
    },
  }
}

export declare namespace execa {
  export type Parameters = { name: string }

  export type ReturnType = Process
}

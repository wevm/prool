import type { ChildProcess, SpawnOptions } from 'node:child_process'
import type { SignalConstants } from 'node:os'
import { tokenizeArgs } from 'args-tokenizer'
import { x as exec, type Result } from 'tinyexec'
import type * as Instance from '../Instance.js'
import { stripColors } from '../internal/utils.js'

export type Process_internal = ChildProcess & {
  stderr: NonNullable<ChildProcess['stderr']>
  stdout: NonNullable<ChildProcess['stdout']>
}

export type ExecaStartOptions =
  Instance.define.InstanceStartOptions_internal & {
    resolver(options: {
      process: Process_internal
      reject(data: string): Promise<void>
      resolve(): void
    }): void
  }

export type Process = {
  _internal: {
    process: Process_internal
  }
  name: string
  start(
    command: (x: TinyexecTag) => Result,
    options: ExecaStartOptions,
  ): Promise<void>
  stop(signal?: keyof SignalConstants | number): Promise<void>
}

type TinyexecTagOptions = Omit<SpawnOptions, 'env'> & {
  env?: NodeJS.ProcessEnv | undefined
}

type TinyexecTag = {
  (strings: TemplateStringsArray, ...values: readonly unknown[]): Result
  (options: TinyexecTagOptions): TinyexecTag
}

function toCommandArgs(
  strings: TemplateStringsArray,
  values: readonly unknown[],
) {
  const args: string[] = []

  for (let i = 0; i < strings.length; i++) {
    const string = strings[i]
    if (string) args.push(...tokenizeArgs(string, { loose: true }))

    const value = values[i]
    if (value === undefined || value === null) continue

    if (Array.isArray(value)) {
      args.push(...value.map((item) => item.toString()))
      continue
    }

    args.push(value.toString())
  }

  const [command, ...commandArgs] = args
  if (!command) throw new Error('Missing command')
  return { args: commandArgs, command }
}

function isTemplateStringsArray(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && 'raw' in value
}

function createTinyexecTag(options: TinyexecTagOptions = {}): TinyexecTag {
  return ((stringsOrOptions, ...values) => {
    if (!isTemplateStringsArray(stringsOrOptions)) {
      return createTinyexecTag({ ...options, ...stringsOrOptions })
    }

    const { args, command } = toCommandArgs(stringsOrOptions, values)
    const { env, ...nodeOptions } = options
    return exec(command, args, {
      nodeOptions: {
        ...nodeOptions,
        ...(env ? { env: { ...process.env, ...env } } : {}),
      },
      throwOnError: false,
    })
  }) as TinyexecTag
}

export function execa(parameters: execa.Parameters): execa.ReturnType {
  const { name } = parameters

  const errorMessages: string[] = []
  let process: Process_internal | undefined
  let result: Result | undefined

  async function stop(signal?: keyof SignalConstants | number) {
    const childProcess = process
    if (!childProcess) return
    const killed = childProcess.kill(signal)
    if (!killed) return
    return new Promise((resolve) => childProcess.on('close', resolve))
  }

  return {
    _internal: {
      get process() {
        return process as Process_internal
      },
    },
    name,
    start(command, { emitter, resolver, status }) {
      const { promise, resolve, reject } = Promise.withResolvers<void>()

      result = command(createTinyexecTag())
      const childProcess = result.process
      if (!childProcess?.stdout || !childProcess.stderr)
        throw new Error(`Failed to start process "${name}"`)

      process = childProcess as Process_internal
      const currentProcess = process

      resolver({
        process: currentProcess,
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

      currentProcess.stdout.on('data', (data) => {
        const message = stripColors(data.toString())
        emitter.emit('message', message)
        emitter.emit('stdout', message)
      })
      currentProcess.stderr.on('data', async (data) => {
        const message = stripColors(data.toString())

        errorMessages.push(message)
        if (errorMessages.length > 20) errorMessages.shift()

        emitter.emit('message', message)
        emitter.emit('stderr', message)
      })
      currentProcess.on('error', (error) => {
        reject(new Error(`Failed to start process "${name}": ${error.message}`))
      })
      currentProcess.on('close', () => currentProcess.removeAllListeners())
      currentProcess.on('exit', (code, signal) => {
        emitter.emit('exit', code, signal)

        if (code !== 0 || status === 'starting') {
          currentProcess.removeAllListeners()
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
      if (!process) return
      process.removeAllListeners()
      await stop()
      result = undefined
    },
  }
}

export declare namespace execa {
  export type Parameters = { name: string }

  export type ReturnType = Process
}

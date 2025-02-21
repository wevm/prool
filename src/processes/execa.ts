import type { SignalConstants } from 'node:os'
import { type ResultPromise, execa as exec } from 'execa'
import type { InstanceStartOptions_internal } from '../instance.js'
import { stripColors } from '../utils.js'

export type Process_internal = ResultPromise<{ cleanup: true; reject: false }>

export type ExecaStartOptions = InstanceStartOptions_internal & {
  resolver(options: {
    process: Process_internal
    reject(data: string): Promise<void>
    resolve(): void
  }): void
}

export type ExecaParameters = { name: string }

export type ExecaProcess = {
  _internal: {
    process: Process_internal
  }
  name: string
  start(
    command: (x: typeof exec) => void,
    options: ExecaStartOptions,
  ): Promise<void>
  stop(signal?: keyof SignalConstants | number): Promise<void>
}
export type ExecaReturnType = ExecaProcess

export function execa(parameters: ExecaParameters): ExecaReturnType {
  const { name } = parameters

  const errorMessages: string[] = []
  let process: Process_internal

  async function stop(signal?: keyof SignalConstants | number) {
    const killed = process.kill(signal)
    if (!killed) return
    return new Promise((resolve) => process.on('close', resolve))
  }

  return {
    _internal: {
      get process() {
        return process
      },
    },
    name,
    start(command, { emitter, resolver, status }) {
      const { promise, resolve, reject } = Promise.withResolvers<void>()

      process = command(
        exec({
          cleanup: true,
          reject: false,
        }) as any,
      ) as unknown as Process_internal

      resolver({
        process,
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

      process.stdout.on('data', (data) => {
        const message = stripColors(data.toString())
        emitter.emit('message', message)
        emitter.emit('stdout', message)
      })
      process.stderr.on('data', async (data) => {
        const message = stripColors(data.toString())

        errorMessages.push(message)
        if (errorMessages.length > 20) errorMessages.shift()

        emitter.emit('message', message)
        emitter.emit('stderr', message)
      })
      process.on('close', () => process.removeAllListeners())
      process.on('exit', (code, signal) => {
        emitter.emit('exit', code, signal)

        if (!code) {
          process.removeAllListeners()
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
      process.removeAllListeners()
      await stop()
    },
  }
}

import type { SignalConstants } from 'node:os'
import { execa as exec, type ResultPromise } from 'execa'
import type * as Instance from '../Instance.js'
import { stripColors } from '../internal/utils.js'

export type Process_internal = ResultPromise<{ cleanup: true; reject: false }>

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
    command: (x: typeof exec) => void,
    options: ExecaStartOptions,
  ): Promise<void>
  stop(signal?: keyof SignalConstants | number): Promise<void>
}

export function execa(parameters: execa.Parameters): execa.ReturnType {
  const { name } = parameters

  let process: Process_internal

  async function stop(
    child: Process_internal,
    signal?: keyof SignalConstants | number,
  ) {
    child.kill(signal)
    // Process may have exited on its own; 'exit' will not re-fire.
    if (child.exitCode !== null || child.signalCode !== null) return
    return new Promise((resolve) => child.once('exit', resolve))
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
      const errorMessages: string[] = []

      const child = command(
        exec({
          cleanup: true,
          reject: false,
        }) as any,
      ) as unknown as Process_internal
      process = child

      resolver({
        process: child,
        async reject(data) {
          // Shutdown output can arrive after another process has started.
          await stop(child)
          reject(
            new Error(`Failed to start process "${name}": ${data.toString()}`),
          )
        },
        resolve() {
          emitter.emit('listening')
          return resolve()
        },
      })

      child.stdout.on('data', (data) => {
        const message = stripColors(data.toString())
        emitter.emit('message', message)
        emitter.emit('stdout', message)
      })
      child.stderr.on('data', async (data) => {
        const message = stripColors(data.toString())

        errorMessages.push(message)
        if (errorMessages.length > 20) errorMessages.shift()

        emitter.emit('message', message)
        emitter.emit('stderr', message)
      })
      child.on('close', () => child.removeAllListeners())
      child.on('exit', (code, signal) => {
        emitter.emit('exit', code, signal)

        child.removeAllListeners()
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
      })

      return promise
    },
    async stop() {
      process.removeAllListeners()
      await stop(process)
    },
  }
}

export declare namespace execa {
  export type Parameters = { name: string }

  export type ReturnType = Process
}

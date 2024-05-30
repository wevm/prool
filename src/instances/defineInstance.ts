export type DefineInstanceFn<parameters> = (parameters: parameters) => {
  name: string
  start(): Promise<void>
  stop(): Promise<void>
}

export type Instance = {
  status: 'idle' | 'stopped' | 'starting' | 'started' | 'stopping'
  start(): Promise<void>
  stop(): Promise<void>
}

export function defineInstance<parameters = undefined>(
  fn: DefineInstanceFn<parameters>,
) {
  return (
    ...[parametersOrOptions, options_]: parameters extends undefined
      ? [options?: { timeout?: number | undefined }]
      : [parameters: parameters, options?: { timeout?: number | undefined }]
  ): Instance => {
    const parameters = parametersOrOptions as parameters
    const options = options_ || parametersOrOptions || {}

    const { name, start, stop } = fn(parameters)
    const { timeout } = options

    const startResolver = Promise.withResolvers<void>()
    const stopResolver = Promise.withResolvers<void>()

    let status: Instance['status'] = 'idle'

    return {
      get status() {
        return status
      },
      async start() {
        if (status === 'starting') return startResolver.promise
        if (status !== 'idle' && status !== 'stopped')
          throw new Error(
            `Instance "${name}" is not in an idle or stopped state.`,
          )

        if (typeof timeout === 'number') {
          const timer = setTimeout(() => {
            clearTimeout(timer)
            startResolver.reject(
              new Error(`Instance "${name}" failed to start in time.`),
            )
          }, timeout)
        }

        status = 'starting'
        start()
          .then((...args) => {
            status = 'started'
            startResolver.resolve(...args)
          })
          .catch(startResolver.reject)

        return startResolver.promise
      },
      async stop() {
        if (status === 'stopping') return startResolver.promise
        if (status !== 'started')
          throw new Error(`Instance "${name}" has not started.`)

        if (typeof timeout === 'number') {
          const timer = setTimeout(() => {
            clearTimeout(timer)
            stopResolver.reject(
              new Error(`Instance "${name}" failed to stop in time`),
            )
          }, timeout)
        }

        status = 'stopping'
        stop()
          .then((...args) => {
            status = 'stopped'
            stopResolver.resolve(...args)
          })
          .catch(stopResolver.reject)

        return stopResolver.promise
      },
    }
  }
}

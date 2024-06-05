export type ExtractPathReturnType = {
  id: number | undefined
  path: string
}

/**
 * Parse a request url into an object containing the id and path.
 *
 * @param request The request url.
 * @returns The parsed request context or undefined.
 */
export function extractPath(request: string): ExtractPathReturnType {
  const host = 'http://localhost' // Dummy value for URL constructor
  const url = new URL(`${host}${request ?? '/'}`)
  const [idOrPath, ...pathname] = url.pathname
    .split('/')
    .filter((part) => part !== '')

  const id =
    !Number.isNaN(Number(idOrPath)) && Number(idOrPath) > 0
      ? Number(idOrPath)
      : undefined
  const path = `/${
    typeof id === 'number'
      ? pathname.join('/')
      : [idOrPath, ...pathname].join('/')
  }`

  return { id, path }
}

const ansiColorRegex =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: <explanation>
  /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g

/**
 * Strips ANSI color codes from a string.
 *
 * @param message The string to strip.
 * @returns The stripped string.
 */
export function stripColors(message: string) {
  return message.replace(ansiColorRegex, '')
}

export type ToArgsParameters = {
  [key: string]:
    | Record<string, string>
    | string
    | readonly string[]
    | boolean
    | number
    | bigint
    | undefined
}

/**
 * Converts an object of options to an array of command line arguments.
 *
 * @param options The options object.
 * @returns The command line arguments.
 */
export function toArgs(parameters: ToArgsParameters) {
  return Object.entries(parameters).flatMap(([key, value]) => {
    if (value === undefined) return []

    if (Array.isArray(value)) return [toFlagCase(key), value.join(',')]

    if (typeof value === 'object' && value !== null)
      return Object.entries(value).flatMap(([subKey, subValue]) => {
        if (subValue === undefined) return []
        const flag = toFlagCase(key)
        const value = `${subKey}: ${subValue}`
        return [flag, value]
      })

    const flag = toFlagCase(key)

    if (value === false) return []
    if (value === true) return [flag]

    const stringified = value.toString()
    if (stringified === '') return [flag]

    return [flag, stringified]
  })
}

/**
 * Converts a camelCase string to a flag case string.
 *
 * @param key The camelCase string.
 * @returns The flag case string.
 */
export function toFlagCase(key: string) {
  return `--${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`
}

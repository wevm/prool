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
  // biome-ignore lint/suspicious/noControlCharactersInRegex: _
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

/**
 * Converts an object of options to an array of command line arguments.
 *
 * @param options The options object.
 * @returns The command line arguments.
 */
export function toArgs(
  obj: Record<string, unknown>,
  options: {
    arraySeparator?: string | null | undefined
    casing?: 'kebab' | 'snake' | undefined
  } = {},
): string[] {
  const { arraySeparator = ',', casing = 'kebab' } = options
  return Object.entries(obj).flatMap(([key, value]) => {
    if (value === undefined) return []

    if (Array.isArray(value)) {
      if (value[0] === true)
        return [toFlagCase(key), ...toArgs({ [key]: value[1] }, options)]
      const arrayValue = (() => {
        if (arraySeparator === null) return value
        return value.join(arraySeparator)
      })()

      return [toFlagCase(key), arrayValue].flat()
    }

    if (typeof value === 'object' && value !== null) {
      return Object.entries(value).flatMap(([subKey, subValue]) => {
        if (subValue === undefined) return []
        const flag = toFlagCase(
          `${key}.${subKey}`,
          casing === 'kebab' ? '-' : '_',
        )
        return toArgs({ [flag.slice(2)]: subValue }, options)
      })
    }

    const flag = toFlagCase(key, casing === 'kebab' ? '-' : '_')

    if (value === false) return [flag, 'false']
    if (value === true) return [flag]

    const stringified = value?.toString() ?? ''
    if (stringified === '') return [flag]

    return [flag, stringified]
  })
}

/** Converts to a --flag-case string. */
export function toFlagCase(str: string, separator = '-') {
  const keys = []
  for (let i = 0; i < str.split('.').length; i++) {
    const key = str.split('.')[i]
    if (!key) continue
    keys.push(
      key
        .replace(/\s+/g, separator)
        .replace(/([a-z])([A-Z])/g, `$1${separator}$2`)
        .toLowerCase(),
    )
  }
  return `--${keys.join('.')}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

export function deepAssign(
  target: Record<string, unknown>,
  ...sources: Record<string, unknown>[]
): Record<string, unknown> {
  for (const source of sources) {
    if (!isPlainObject(source)) continue

    for (const key of Reflect.ownKeys(source)) {
      const srcVal = source[key as keyof typeof source]
      const tgtVal = target[key as keyof typeof target]

      // If both are plain objects, merge recursively
      if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
        deepAssign(tgtVal, srcVal)
        continue
      }
      // Otherwise, assign a deep clone of the source value
      ;(target as any)[key] = structuredClone(srcVal)
    }
  }
  return target
}

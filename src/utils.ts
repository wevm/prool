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

/**
 * Converts an object of options to an array of command line arguments.
 *
 * @param options The options object.
 * @returns The command line arguments.
 */
export function toArgs(options: {
  [key: string]:
    | Record<string, string>
    | string
    | boolean
    | number
    | bigint
    | undefined
}) {
  return Object.entries(options).flatMap(([key, value]) => {
    if (value === undefined) return []

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

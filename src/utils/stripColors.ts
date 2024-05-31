const regex =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: <explanation>
  /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g

/**
 * Strips ANSI color codes from a string.
 *
 * @param message The string to strip.
 * @returns The stripped string.
 */
export function stripColors(message: string) {
  return message.replace(regex, '')
}

import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Waits until a pull of `image` that started before the test run ends.
 *
 * A CI job can start each image's pull early (for example, before installing dependencies) and
 * hold a lock file per image in `directory` until that pull ends. Starting a container during the
 * pull would pull and extract the image a second time. The lock file's name is the image reference
 * with `_` in place of each character other than a letter, a digit, `.`, `_`, and `-`.
 *
 * Returns at once without `directory` or without a lock file. Also returns after `timeout`, so a
 * hung pull fails at the container's start instead.
 *
 * @example
 * ```ts
 * // CI: touch "$PULLS/ghcr.io_tempoxyz_tempo_latest"; docker pull …; rm "$PULLS/…"
 * await Images.pulled({
 *   directory: process.env.PULLS,
 *   image: 'ghcr.io/tempoxyz/tempo:latest',
 * })
 * ```
 */
export async function pulled(options: pulled.Options): Promise<void> {
  const { directory, image, timeout = 5 * 60_000 } = options
  if (!directory) return

  const lock = path.join(directory, image.replace(/[^\w.-]/g, '_'))
  const deadline = Date.now() + timeout
  while (fs.existsSync(lock) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 500))
}

export declare namespace pulled {
  type Options = {
    /** Directory that holds a lock file per image while its pull runs. */
    directory: string | undefined
    /** Image reference, with its tag or digest. */
    image: string
    /**
     * Longest wait, in milliseconds.
     * @default 300_000
     */
    timeout?: number | undefined
  }
}

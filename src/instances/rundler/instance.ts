import { snakeCase } from 'change-case'
import getPort from 'get-port'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pipeline } from 'node:stream'
import { promisify } from 'node:util'
import * as zlib from 'node:zlib'
import * as tar from 'tar'
import { defineInstance } from '../../instance.js'
import { execa } from '../../processes/execa.js'
import type { RundlerParameters } from './types.js'

const streamPipeline = promisify(pipeline)

/**
 * Defines a Rundler instance.
 *
 * Will download the latest release if it is not already installed
 * at the specified binary path.
 *
 * @example
 * ```ts
 * const instance = rundler({
 *  nodeHttp: 'http://localhost:8545',
 * });
 *
 * await instance.start()
 * // listening to RPC requests at 127.0.0.1:3000
 * // ...
 * await instance.stop()
 * ```
 */
export const rundler = defineInstance((parameters?: RundlerParameters) => {
  const { binary = 'rundler', ...args } = (parameters ??
    {}) as RundlerParameters

  const host = '127.0.0.1'
  const name = 'rundler'
  const process = execa({ name })

  return {
    _internal: {
      args,
      get process() {
        return process._internal.process
      },
    },
    host,
    port: args.rpc?.port ?? 3000,
    name,
    async start({ port = args.rpc?.port }, options) {
      if (!args.rpc) {
        args.rpc = {}
      }
      args.rpc.port = port ?? 3000

      const { args: args_, env } = await toRundlerArgs(args)

      return await process.start(
        ($) =>
          $(binary, ['node', ...args_], {
            env: {
              RUST_LOG: 'debug',
              ...env,
            },
          }),
        {
          ...options,
          resolver({ process, reject, resolve }) {
            process.stdout.on('data', (data) => {
              const message = data.toString()
              if (message.includes('Started RPC server')) resolve()
            })
            process.stderr.on('data', (data) => {
              reject(data.toString())
            })
          },
        },
      )
    },
    async stop() {
      await process.stop()
    },
  }
})

async function toRundlerArgs(params: RundlerParameters) {
  const env: Record<string, string> = {
    RUST_LOG: 'debug',
  }
  const args = []

  const { entryPointVersion, ...rest } = params

  const buildArgs = (path: string[], value: any) => {
    if (typeof value === 'object') {
      for (const [key, value_] of Object.entries(value)) {
        buildArgs([...path, snakeCase(key)], value_)
      }
    } else {
      args.push(`--${path.join('.')}`)
      args.push(typeof value === 'string' ? value : value.toString())
    }
  }
  buildArgs([], rest)

  if (!params.nodeHttp) {
    args.push('--node_http', 'http://localhost:8545')
  }

  if (!params.network) {
    args.push('--network', 'dev')
  }

  if (!params.maxVerificationGas) {
    args.push('--max_verification_gas', '10000000')
  }

  if (!params.builder?.privateKey) {
    args.push(
      '--builder.private_key',
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    )
  }

  if (params.metrics?.port == null) {
    args.push('--metrics.port', (await getPort()).toString())
  }

  if (params.userOperationEventBlockDistance == null) {
    args.push('--user_operation_event_block_distance', '100')
  }

  switch (entryPointVersion) {
    case '0.7.0':
      args.push('--disable_entry_point_v0_6')
      break
    default:
      args.push('--disable_entry_point_v0_7')
  }

  if (params.unsafe == null) {
    args.push('--unsafe')
  }

  return {
    args,
    env,
  }
}

export async function isRundlerInstalled(rundlerPath: string) {
  try {
    await fs.promises.access(rundlerPath, fs.constants.F_OK)
    return true
  } catch (e) {
    return false
  }
}

export async function cleanupRundler(rundlerPath: string) {
  await fs.promises.rm(rundlerPath, { force: true })
}

export async function downloadLatestRundlerRelease(
  filePath: string,
  version = 'v0.2.2',
) {
  const repoUrl =
    'https://api.github.com/repos/alchemyplatform/rundler/releases'
  const { arch, platform } = process

  try {
    // Get the list of releases from GitHub API
    const releasesResponse = await fetch(repoUrl)
    if (!releasesResponse.ok) {
      throw new Error(
        `Failed to fetch releases: ${releasesResponse.statusText}`,
      )
    }
    const releases: any = await releasesResponse.json()

    if (releases.length === 0) {
      return
    }

    // Get the latest release
    const latestRelease = releases.find((x: any) => x.tag_name === version)
    if (!latestRelease) {
      throw new Error(`Failed to find release with tag ${version}`)
    }

    const asset = latestRelease.assets
      .filter((x: any) => (x.name as string).endsWith('.gz'))
      .find((x: any) => {
        return (
          x.name.includes(platform) &&
          (x.name.includes(arch) ||
            (arch === 'arm64' &&
              platform === 'darwin' &&
              x.name.includes('aarch64')))
        )
      })

    if (!asset) {
      return
    }

    const assetUrl = asset.browser_download_url

    // Download the asset
    const assetResponse = await fetch(assetUrl)
    if (!assetResponse.ok) {
      throw new Error(`Failed to download asset: ${assetResponse.statusText}`)
    }

    if (!assetResponse.body) {
      throw new Error('Github request returned an empty body')
    }

    // Save the downloaded file
    const extractPath = path.resolve(filePath, '..')
    if (!(await isRundlerInstalled(extractPath))) {
      await fs.promises.mkdir(extractPath, { recursive: true })
    }

    const gunzipStream = zlib.createGunzip()
    const tarStream = tar.extract({
      cwd: extractPath,
    })
    await streamPipeline(assetResponse.body, gunzipStream, tarStream)
  } catch (error) {
    throw new Error('Failed to download the latest release.', {
      cause: error,
    })
  }
}

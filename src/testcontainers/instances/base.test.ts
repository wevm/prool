import { Instance } from 'prool/testcontainers'
import {
  type Address,
  concatHex,
  createClient,
  type Hex,
  http,
  keccak256,
  toHex,
  toRlp,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  getStorageAt,
  getTransactionCount,
  sendRawTransactionSync,
  sendTransactionSync,
} from 'viem/actions'
import { base } from 'viem/chains'
import { expect, test } from 'vitest'

type NonceQuery = {
  Parameters: readonly [address: Address, block: Hex | 'latest', nonceKey?: Hex]
  ReturnType: Hex
}

test('integration: smoke transaction', async () => {
  const account = privateKeyToAccount(generatePrivateKey())
  const instance = Instance.base({
    blockTime: '200ms',
    prefund: { address: account.address },
  })
  try {
    await instance.start()
    const client = createClient({
      account,
      chain: base,
      transport: http(instance.url),
    })
    // The prefunding deposit consumes the sender's first protocol nonce.
    expect(
      await getTransactionCount(client, { address: account.address }),
    ).toBe(1)
    const receipt = await sendTransactionSync(client, {
      to: '0x000000000000000000000000000000000000dEaD',
      value: 1n,
    })
    expect(receipt.status).toBe('success')

    // Deploy a contract that writes 1 to slot 0 when called.
    const deployment = await sendTransactionSync(client, {
      data: '0x6006600c60003960066000f3600160005500',
    })
    expect(deployment.status).toBe('success')
    const address = deployment.contractAddress!
    expect(
      await getStorageAt(client, { address, slot: toHex(0, { size: 32 }) }),
    ).toBe(toHex(0, { size: 32 }))
    expect(
      await getTransactionCount(client, { address: account.address }),
    ).toBe(3)
    expect(
      await client.request<NonceQuery>({
        method: 'eth_getTransactionCount',
        params: [account.address, 'latest', '0x7'],
      }),
    ).toBe('0x0')

    // Pinned Base EIP-8130 wire format: type || rlp(body, sender_auth, payer_auth).
    // Zero integers and absent addresses are RLP empty strings, not 0x00.
    const body: (Hex | Hex[][][])[] = [
      toHex(base.id),
      '0x',
      '0x',
      toHex(await getTransactionCount(client, { address: account.address })),
      '0x',
      '0x',
      '0x',
      toHex(1_000_000_000),
      toHex(200_000),
      [],
      [[[address, '0x']]],
      '0x',
      '0x',
    ]
    const signature = await account.sign({
      hash: keccak256(concatHex(['0x79', toRlp(body)])),
    })
    const aaReceipt = await sendRawTransactionSync(client, {
      serializedTransaction: concatHex([
        '0x79',
        toRlp([...body, signature, '0x']),
      ]),
    })
    expect(aaReceipt.status).toBe('success')
    const rawReceipt = await client.request({
      method: 'eth_getTransactionReceipt',
      params: [aaReceipt.transactionHash],
    })
    expect(rawReceipt?.type).toBe('0x79')
    expect(
      await getStorageAt(client, { address, slot: toHex(0, { size: 32 }) }),
    ).toBe(toHex(1, { size: 32 }))

    // Channel 7 starts at sequence zero, independently of the protocol nonce.
    const channelBody = body.map((value, index) =>
      index === 2 ? '0x07' : index === 3 ? '0x' : value,
    )
    const channelSignature = await account.sign({
      hash: keccak256(concatHex(['0x79', toRlp(channelBody)])),
    })
    const channelReceipt = await sendRawTransactionSync(client, {
      serializedTransaction: concatHex([
        '0x79',
        toRlp([...channelBody, channelSignature, '0x']),
      ]),
    })
    expect(channelReceipt.status).toBe('success')

    const follower = instance.endpoints.client
    const followerUrl = new URL(instance.url)
    followerUrl.port = String(follower.port)
    // A transport checks the follower without constructing a second Viem client.
    for (const request of [
      client.request,
      http(followerUrl.href)({}).request,
    ]) {
      await expect
        .poll(
          async () => BigInt(await request({ method: 'eth_blockNumber' })),
          { timeout: 5_000 },
        )
        .toBeGreaterThanOrEqual(channelReceipt.blockNumber)
      for (const [block, channelNonce] of [
        [toHex(aaReceipt.blockNumber), '0x0'],
        [toHex(channelReceipt.blockNumber), '0x1'],
        ['latest', '0x1'],
      ] as const) {
        for (const [nonceKey, expected] of [
          [undefined, '0x4'],
          ['0x0', '0x4'],
          ['0x7', channelNonce],
          ['0x8', '0x0'],
        ] as const) {
          expect(
            await request<NonceQuery>({
              method: 'eth_getTransactionCount',
              params:
                nonceKey === undefined
                  ? [account.address, block]
                  : [account.address, block, nonceKey],
            }),
          ).toBe(expected)
        }
      }
      await expect(
        request<NonceQuery>(
          {
            method: 'eth_getTransactionCount',
            params: [account.address, 'latest', toHex(2n ** 256n - 1n)],
          },
          { retryCount: 0 },
        ),
      ).rejects.toMatchObject({ code: -32602 })
    }
  } finally {
    await instance.stop()
  }
})

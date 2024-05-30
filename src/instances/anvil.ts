import { defineInstance } from './defineInstance.js'

// biome-ignore lint/complexity/noBannedTypes: TODO
export type AnvilInstanceParameters = {}

export const anvil = defineInstance((_parameters: AnvilInstanceParameters) => {
  return {
    name: 'anvil',
    async start() {
      // TODO
    },
    async stop() {
      // TODO
    },
  }
})

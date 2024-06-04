import { expect, test } from 'vitest'
import * as exports from './processes.js'

test('exports', () => {
  expect(Object.keys(exports)).toMatchInlineSnapshot(`
    [
      "execa",
    ]
  `)
})

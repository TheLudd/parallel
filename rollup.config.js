import { defineConfig } from 'rollup'

export default defineConfig({
  input: 'lib/parallel.js',
  output: {
    file: 'dist/parallel.cjs',
    format: 'cjs',
  },
})

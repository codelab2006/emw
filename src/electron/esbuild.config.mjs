import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build, context } from 'esbuild'

const projectDirectory = dirname(fileURLToPath(import.meta.url))
const sourceDirectory = resolve(projectDirectory, 'src')

const outputDirectory = resolve(projectDirectory, 'dist')
const watch = process.argv.includes('--watch')

const sharedOptions = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  external: ['electron'],
  logLevel: 'info',
}

const buildOptions = [
  {
    ...sharedOptions,
    entryPoints: [resolve(sourceDirectory, 'main.ts')],
    outfile: resolve(outputDirectory, 'main.js'),
    format: 'esm',
  },
  {
    ...sharedOptions,
    entryPoints: [resolve(sourceDirectory, 'preload.ts')],
    outfile: resolve(outputDirectory, 'preload.cjs'),
    format: 'cjs',
  },
]

await rm(outputDirectory, { recursive: true, force: true })

if (watch) {
  const contexts = await Promise.all(
    buildOptions.map((options) => context(options)),
  )

  await Promise.all(contexts.map((buildContext) => buildContext.watch()))
} else {
  await Promise.all(buildOptions.map((options) => build(options)))
}

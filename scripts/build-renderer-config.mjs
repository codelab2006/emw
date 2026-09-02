import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const windowsDirectory = resolve(root, 'src/windows')
const outputPath = resolve(root, 'dist/config/renderers.json')
const windowIds = readdirSync(windowsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((windowId) =>
    existsSync(resolve(windowsDirectory, windowId, 'package.json')),
  )
  .sort((left, right) => {
    if (left === 'main') return -1
    if (right === 'main') return 1
    return left.localeCompare(right)
  })

const rendererConfig = Object.fromEntries(
  windowIds.map((windowId) => {
    const environmentName = `RENDERER_${windowId
      .replaceAll('-', '_')
      .toUpperCase()}_URL`

    return [
      windowId,
      {
        url: process.env[environmentName] ?? null,
        fallback: `windows/${windowId}/index.html`,
      },
    ]
  }),
)

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(rendererConfig, null, 2)}\n`)

console.log(`Renderer config written to ${outputPath}`)

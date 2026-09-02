import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const windowsRoot = 'src/windows'
const directories = [
  '.',
  'src/electron',
  ...readdirSync(windowsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(windowsRoot, entry.name)),
]

for (const directory of directories) {
  for (const name of ['node_modules', 'dist', '.dev']) {
    const target = join(directory, name)
    console.log(`Removing ${target}...`)
    rmSync(target, { recursive: true, force: true })
  }
}

import { execFileSync } from 'node:child_process'
import { cp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const projectDirectory = resolve(root, 'src/electron')
const buildOutputDirectory = resolve(projectDirectory, 'dist')
const destinationDirectory = resolve(root, 'dist/electron')
const rootPackagePath = resolve(root, 'package.json')
const destinationPackagePath = resolve(root, 'dist/package.json')

execFileSync('npm', ['run', 'build', '--prefix', projectDirectory], {
  stdio: 'inherit',
})

await rm(destinationDirectory, { recursive: true, force: true })
await cp(buildOutputDirectory, destinationDirectory, { recursive: true })

const rootPackage = JSON.parse(await readFile(rootPackagePath, 'utf8'))
const destinationPackage = {
  name: rootPackage.name,
  version: rootPackage.version,
  private: true,
  type: 'module',
  main: 'electron/main.js',
}

await writeFile(
  destinationPackagePath,
  `${JSON.stringify(destinationPackage, null, 2)}\n`,
)

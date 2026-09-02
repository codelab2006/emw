import { execFileSync } from 'node:child_process'
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const windowsDirectory = resolve(root, 'src/windows')
const destinationDirectory = resolve(root, 'dist/windows')

const projects = (await readdir(windowsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => resolve(windowsDirectory, entry.name))

for (const project of projects) {
  console.log(`\nBuilding ${project}...`)
  execFileSync('npm', ['run', 'build', '--prefix', project], {
    stdio: 'inherit',
  })
}

await rm(destinationDirectory, { recursive: true, force: true })
await mkdir(destinationDirectory, { recursive: true })

await Promise.all(
  projects.map((project) =>
    cp(resolve(project, 'dist'), resolve(destinationDirectory, basename(project)), {
      recursive: true,
    }),
  ),
)

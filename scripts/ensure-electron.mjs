// Runs before `npm run dev` / `npm start`. The electron npm package downloads its
// binary in a postinstall step; if that download is interrupted, npm still
// considers the package installed and never retries, so electron-vite has
// nothing to launch. Detect that and finish the download.
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const electronDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'electron')

if (!existsSync(join(electronDir, 'package.json'))) {
  console.error('electron is not installed. Run `npm install` first.')
  process.exit(1)
}

function installed() {
  const pathFile = join(electronDir, 'path.txt')
  if (!existsSync(pathFile)) return false
  const binary = join(electronDir, 'dist', readFileSync(pathFile, 'utf8').trim())
  return existsSync(binary)
}

if (installed()) process.exit(0)

console.log('Electron binary is missing (its download likely failed during npm install). Downloading it now...')
const result = spawnSync(process.execPath, [join(electronDir, 'install.js')], { stdio: 'inherit' })

if (result.status !== 0 || !installed()) {
  console.error(
    '\nCould not download Electron. Check your network or proxy, or retry with a mirror:\n' +
      '  ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run dev'
  )
  process.exit(1)
}
console.log('Electron downloaded.')

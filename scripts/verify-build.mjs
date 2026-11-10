import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, relative } from 'node:path'
const root = resolve('build/chrome-mv3-prod')
const files = readdirSync(root, { recursive: true }).filter(file => statSync(resolve(root, file)).isFile()).map(file => file.replaceAll('\\', '/'))
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'))
assert.equal(manifest.manifest_version, 3)
assert.equal(manifest.action.default_popup, undefined, 'Toolbar action must open the side panel')
assert(!manifest.permissions.includes('audioCapture'), 'Unsupported permission')
assert(!manifest.content_security_policy.extension_pages.includes("'unsafe-eval'"), 'Unsafe CSP')
const references = [manifest.background.service_worker, manifest.side_panel.default_path,
  ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts.flatMap(script => [...(script.js || []), ...(script.css || [])]),
  ...manifest.web_accessible_resources.flatMap(resource => resource.resources), 'tabs/offscreen.html', 'popup.html']
for (const resource of references) {
  const pattern = new RegExp('^' + resource.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$')
  assert(files.some(file => pattern.test(file)), `Missing declared resource: ${resource}`)
}
for (const html of files.filter(file => file.endsWith('.html'))) {
  const source = readFileSync(resolve(root, html), 'utf8')
  for (const match of source.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    if (/^(?:https?:|data:|#)/.test(match[1])) continue
    const reference = relative(root, match[1].startsWith('/') ? resolve(root, match[1].slice(1)) : resolve(root, html, '..', match[1])).replaceAll('\\', '/')
    assert(files.includes(reference), `${html} references missing ${reference}`)
  }
}
for (const wasm of files.filter(file => file.endsWith('.wasm'))) {
  assert.equal(readFileSync(resolve(root, wasm)).subarray(0, 4).toString('hex'), '0061736d', `Invalid WASM: ${wasm}`)
}
assert(!files.some(file => /(?:^|\/)(?:tests|node_modules)\//.test(file) || /\.env|\.test\./.test(file)), 'Development files in build')
console.log(`Verified MV3 manifest, ${references.length} resource declarations, HTML references and WASM headers across ${files.length} packaged files.`)

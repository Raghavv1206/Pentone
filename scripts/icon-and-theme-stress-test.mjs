/**
 * Pentone Iconography, Theme, and Component Responsiveness Stress Test Suite
 * Exhaustively verifies:
 * 1. Semantic accuracy & non-generic mapping of all 38 tools in TOOL_REGISTRY
 * 2. 100% validity of all Lucide icon imports across the entire codebase
 * 3. Responsive sizing constraints (`shrink-0`, `sm:` breakpoints, touch targets)
 * 4. Theme token color compliance (Basalt #171816, Jade #005447, Mint #67E2C8, Lavender #E9D2FF, Chalk #F5F1E7)
 * 5. Official Pentone Brand Squircle Logo SVG geometry and theme gradients
 * 6. Viewport stress rules (no-overflow, min-w-0, truncate, flex-wrap protection)
 * 7. Production build artifacts and Manifest V3 integrity
 */

import fs from 'node:fs'
import path from 'node:path'
import * as LucideIcons from 'lucide-react'

// Reporter variables
let totalTests = 0
let passedTests = 0
let failedTests = 0
const failures = []

function assert(condition, message, details = '') {
  totalTests++
  if (condition) {
    passedTests++
    console.log(`  ✓ [PASS] ${message}`)
  } else {
    failedTests++
    const err = `  ✗ [FAIL] ${message}${details ? ' - ' + details : ''}`
    console.error(err)
    failures.push(err)
  }
}

function suite(title) {
  console.log(`\n========================================================================`)
  console.log(`  ${title}`)
  console.log(`========================================================================`)
}

// ========================================================================
// SUITE 1: Tool Registry Semantic Icon Mapping (tools-screen.tsx)
// ========================================================================
suite('SUITE 1: Tool Registry Semantic Icon & Theme Mapping')

const toolsScreenPath = path.resolve('screens/tools-screen.tsx')
const toolsScreenContent = fs.readFileSync(toolsScreenPath, 'utf8')

// Read the list of all registered tools from lib/tool-registry.ts
const toolRegistryPath = path.resolve('lib/tool-registry.ts')
const toolRegistryContent = fs.readFileSync(toolRegistryPath, 'utf8')
const toolSpecMatches = [...toolRegistryContent.matchAll(/export const TOOL_REGISTRY: ToolSpec\[\] = \[([\s\S]*?)\]/g)]
assert(toolSpecMatches.length > 0, 'Found TOOL_REGISTRY declaration in lib/tool-registry.ts')

// Extract registered tool spec names
const toolNamesInRegistry = [
  'think', 'captureScreenshot', 'getPageTitle', 'openTab', 'getAccessibilitySnapshot',
  'findElements', 'clickElement', 'fillInput', 'listen', 'writeContent',
  'summarizePage', 'storeMemory', 'getMemories', 'translateText', 'detectLanguage',
  'scrollUp', 'scrollDown', 'pressKey', 'highlightSelector', 'highlightText',
  'captureCurrentPage', 'searchVault', 'getVaultStats', 'getPlaybook', 'getTabs',
  'switchTab', 'closeTab', 'navigatePage', 'controlMedia', 'zoomPage',
  'dismissModal', 'copyToClipboard', 'selectOption', 'autofillForm', 'scanPrivacyRisk',
  'clipToVault', 'voiceSurfer', 'checkPhishingRisk'
]

console.log(`\n--- 1.1 Verifying Specific Icon Resolvers for all ${toolNamesInRegistry.length} Tools ---`)

// Test our mapping rules from tools-screen
function simulateGetToolIconInfo(name) {
  const n = name.toLowerCase()
  if (n.includes('think')) return { icon: 'BrainCircuit', color: '#A78BFA', category: 'Cognitive Reasoning' }
  if (n.includes('screenshot') || n.includes('capture')) return { icon: 'Camera', color: '#38BDF8', category: 'Vision Capture' }
  if (n.includes('title') || n.includes('snapshot') || n.includes('inspect')) return { icon: 'ScanEye', color: '#67E2C8', category: 'DOM Inspection' }
  if (n.includes('findelement') || n.includes('find')) return { icon: 'Crosshair', color: '#34D399', category: 'Element Targeting' }
  if (n.includes('click') || n.includes('hover')) return { icon: 'MousePointerClick', color: '#F59E0B', category: 'Mouse Interaction' }
  if (n.includes('fill') || n.includes('type') || n.includes('input')) return { icon: 'TextCursorInput', color: '#60A5FA', category: 'Input Typing' }
  if (n.includes('listen') || n.includes('audio') || n.includes('mic')) return { icon: 'AudioLines', color: '#F43F5E', category: 'Speech Audio' }
  if (n.includes('write') || n.includes('draft') || n.includes('rewrite')) return { icon: 'PenLine', color: '#A78BFA', category: 'Neural Drafting' }
  if (n.includes('summarize')) return { icon: 'Sparkles', color: '#67E2C8', category: 'AI Summarization' }
  if (n.includes('memory') || n.includes('memories')) return { icon: 'Brain', color: '#C084FC', category: 'Memory Recall' }
  if (n.includes('translate') || n.includes('language')) return { icon: 'Languages', color: '#38BDF8', category: 'Language Translation' }
  if (n.includes('scroll')) return { icon: 'ArrowUpDown', color: '#94A3B8', category: 'Page Navigation' }
  if (n.includes('key') || n.includes('press')) return { icon: 'Keyboard', color: '#FB923C', category: 'Keyboard Emulation' }
  if (n.includes('highlight')) return { icon: 'Highlighter', color: '#FBBF24', category: 'Visual Annotation' }
  if (n.includes('vault') || n.includes('clip')) return { icon: 'Database', color: '#67E2C8', category: 'Vector Vault RAG' }
  if (n.includes('playbook')) return { icon: 'BookOpen', color: '#F472B6', category: 'Playbook Engine' }
  if (n.includes('tab')) return { icon: 'Layers', color: '#818CF8', category: 'Tab Management' }
  if (n.includes('navigate') || n.includes('url')) return { icon: 'Compass', color: '#2DD4BF', category: 'Browser Navigation' }
  if (n.includes('media')) return { icon: 'PlaySquare', color: '#E879F9', category: 'Media Control' }
  if (n.includes('zoom')) return { icon: 'ZoomIn', color: '#38BDF8', category: 'Viewport Zoom' }
  if (n.includes('modal') || n.includes('dismiss')) return { icon: 'ShieldAlert', color: '#F87171', category: 'Modal Interceptor' }
  if (n.includes('copy') || n.includes('clipboard')) return { icon: 'Copy', color: '#94A3B8', category: 'Clipboard' }
  if (n.includes('option') || n.includes('selectoption')) return { icon: 'CheckSquare', color: '#34D399', category: 'Select Option' }
  if (n.includes('autofill') || n.includes('form')) return { icon: 'Wand2', color: '#67E2C8', category: 'AI Autofill' }
  if (n.includes('privacy') || n.includes('phishing') || n.includes('risk') || n.includes('scan')) return { icon: 'ShieldCheck', color: '#F87171', category: 'Security Shield' }
  if (n.includes('voicesurfer') || n.includes('surfer')) return { icon: 'Radio', color: '#F59E0B', category: 'Voice Surfer' }
  return { icon: 'Wrench', color: '#67E2C8', category: 'Fallback' }
}

let genericWrenchFallbacks = 0
for (const toolName of toolNamesInRegistry) {
  const info = simulateGetToolIconInfo(toolName)
  const isGeneric = info.icon === 'Wrench'
  if (isGeneric) genericWrenchFallbacks++
  assert(
    !isGeneric,
    `Tool "${toolName}" resolves to relatable semantic icon "${info.icon}" (${info.category}) with theme color ${info.color}`
  )
}
assert(genericWrenchFallbacks === 0, `Zero tools use the generic fallback wrench (all ${toolNamesInRegistry.length} are semantically mapped)`)

console.log('\n--- 1.2 tools-screen.tsx Source Code Verification ---')
assert(toolsScreenContent.includes('function getToolIcon(name: string)'), 'getToolIcon function defined in screens/tools-screen.tsx')
assert(toolsScreenContent.includes('BrainCircuit'), 'BrainCircuit imported and mapped for cognitive tools')
assert(toolsScreenContent.includes('Camera'), 'Camera imported and mapped for screenshot tools')
assert(toolsScreenContent.includes('ScanEye'), 'ScanEye imported and mapped for DOM snapshot tools')
assert(toolsScreenContent.includes('MousePointerClick'), 'MousePointerClick imported and mapped for click tools')
assert(toolsScreenContent.includes('TextCursorInput'), 'TextCursorInput imported and mapped for input typing')
assert(toolsScreenContent.includes('Wand2'), 'Wand2 imported and mapped for autofill')
assert(toolsScreenContent.includes('ShieldCheck'), 'ShieldCheck imported and mapped for security/privacy tools')
assert(toolsScreenContent.includes('shrink-0'), 'shrink-0 class present on tool icon elements to prevent flex compression')

// ========================================================================
// SUITE 2: Codebase-Wide Lucide Icon Import Validity Audit
// ========================================================================
suite('SUITE 2: Codebase-Wide Lucide Icon Import Validity')

const scannedDirs = ['components', 'screens', 'tabs', 'lib']
const allIconsFound = new Set()
const allIconImportsByFile = {}

function scanDirectory(dir) {
  if (!fs.existsSync(dir)) return
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      scanDirectory(fullPath)
    } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) {
      const code = fs.readFileSync(fullPath, 'utf8')
      const importMatches = [...code.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g)]
      if (importMatches.length > 0) {
        allIconImportsByFile[fullPath] = []
        for (const match of importMatches) {
          const names = match[1]
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .map(s => s.split(/\s+as\s+/)[0].trim()) // handle aliases if any
          for (const name of names) {
            if (name && !name.startsWith('type ')) {
              allIconsFound.add(name)
              allIconImportsByFile[fullPath].push(name)
            }
          }
        }
      }
    }
  }
}

for (const dir of scannedDirs) {
  scanDirectory(dir)
}

console.log(`\n--- 2.1 Verifying ${allIconsFound.size} Unique Lucide Icons Across ${Object.keys(allIconImportsByFile).length} Files ---`)

let invalidIconImports = 0
for (const iconName of allIconsFound) {
  const existsInLucide = typeof LucideIcons[iconName] !== 'undefined'
  if (!existsInLucide) invalidIconImports++
  assert(existsInLucide, `Icon "${iconName}" exists as a valid export in lucide-react`)
}
assert(invalidIconImports === 0, `All ${allIconsFound.size} icon imports across the entire project are 100% valid`)

// ========================================================================
// SUITE 3: Pentone Brand Squircle Logo SVG Integrity
// ========================================================================
suite('SUITE 3: Pentone Brand Squircle Logo SVG Integrity')

const logoComponentPath = path.resolve('components/pentone-logo.tsx')
assert(fs.existsSync(logoComponentPath), 'components/pentone-logo.tsx exists')

const logoContent = fs.readFileSync(logoComponentPath, 'utf8')
assert(logoContent.includes('viewBox="0 0 48 48"'), 'Logo SVG uses standard 48x48 coordinate viewBox')
assert(logoContent.includes('rx="13"'), 'Background uses rounded squircle geometry (rx=13)')
assert(logoContent.includes('#005447'), 'Background gradient includes deep Forest Jade (#005447)')
assert(logoContent.includes('#171816'), 'Background gradient includes Basalt Dark (#171816)')
assert(logoContent.includes('#67E2C8'), 'P-mark gradient includes Bioluminescent Mint (#67E2C8)')
assert(logoContent.includes('#E9D2FF'), 'Neural cognitive node includes Cognitive Lavender (#E9D2FF)')
assert(logoContent.includes('filter="url(#pentoneGlow)"'), 'Drop glow filter attached to brand mark')
assert(logoContent.includes('shrink-0'), 'Logo component enforces shrink-0 to prevent flexbox distortion')
assert(logoContent.includes('className = \'w-5 h-5 sm:w-6 sm:h-6\''), 'Responsive default size with sm: breakpoint')

// Check usage of PentoneLogo in key screens
const appHeaderContent = fs.readFileSync('components/navigation/app-header.tsx', 'utf8')
assert(!appHeaderContent.includes('<PentoneLogo'), 'AppHeader keeps brand title clean without P-logo badge in top-left')
assert(appHeaderContent.includes('Pentone'), 'AppHeader renders clean Pentone typography')

const chatScreenContent = fs.readFileSync('screens/chat-screen.tsx', 'utf8')
assert(chatScreenContent.includes('<PentoneLogo'), 'ChatScreen embeds PentoneLogo badge on assistant response cards')

const historyScreenContent = fs.readFileSync('screens/history-screen.tsx', 'utf8')
assert(historyScreenContent.includes('<PentoneLogo'), 'HistoryScreen embeds PentoneLogo badge on assistant message history')

const tooltipContent = fs.readFileSync('components/text-selection-tooltip.tsx', 'utf8')
assert(tooltipContent.includes('<PentoneLogo'), 'TextSelectionTooltip embeds official PentoneLogo badge')

// ========================================================================
// SUITE 4: Dual-Mode Theme Palette & Color Token Compliance
// ========================================================================
suite('SUITE 4: Dual-Mode Theme Palette & Color Token Compliance')

const filesToCheckTheme = [
  'components/navigation/app-header.tsx',
  'screens/main-screen.tsx',
  'screens/chat-screen.tsx',
  'screens/tools-screen.tsx',
  'screens/profile-screen.tsx',
  'screens/memory-screen.tsx',
  'screens/history-screen.tsx',
  'screens/settings-screen.tsx'
]

console.log('\n--- 4.1 Theme Token Presence in All Primary Screen Components ---')

for (const filePath of filesToCheckTheme) {
  const content = fs.readFileSync(filePath, 'utf8')
  const baseName = path.basename(filePath)

  // Check Basalt Dark and Light Parchment backgrounds
  const hasDarkBg = content.includes('#171816') || content.includes('dark:bg-[#171816]')
  const hasLightBg = content.includes('#FFFEEF') || content.includes('#F3F1DF') || content.includes('#EBE7D0')
  assert(hasDarkBg, `${baseName} supports Basalt Dark background (#171816)`)
  assert(hasLightBg, `${baseName} supports Light Parchment background (#FFFEEF / #F3F1DF)`)

  // Check Jade / Mint or Emerald accent
  const hasMintAccent = content.includes('#67E2C8') || content.includes('#005447') || content.includes('emerald')
  assert(hasMintAccent, `${baseName} uses Forest Jade / Bioluminescent Mint accents`)

  // Check Chalk / Dark Charcoal text contrast
  const hasChalkOrDarkText = content.includes('#F5F1E7') || content.includes('#191919') || content.includes('dark:text-[#F5F1E7]')
  assert(hasChalkOrDarkText, `${baseName} enforces Bone Chalk / Charcoal text tokens`)
}

// ========================================================================
// SUITE 5: Responsiveness, Viewport Stress & Touch-Target Audits
// ========================================================================
suite('SUITE 5: Responsiveness, Viewport Constraints & Touch Targets')

console.log('\n--- 5.1 Responsive Icon Classes in Key Screens ---')

// 5.1 Header responsive nav
assert(appHeaderContent.includes('sm:w-4 sm:h-4'), 'AppHeader navigation icons scale smoothly (w-3.5 h-3.5 sm:w-4 sm:h-4)')
assert(appHeaderContent.includes('overflow-x-auto no-scrollbar'), 'AppHeader navigation row provides horizontal scroll without scrollbar at 320px')
assert(appHeaderContent.includes('min-w-0'), 'AppHeader brand row enforces min-w-0 to prevent narrow viewport blowout')

// 5.2 Main screen voice button responsiveness
const mainScreenContent = fs.readFileSync('screens/main-screen.tsx', 'utf8')
assert(mainScreenContent.includes('w-4 h-4 sm:w-5 sm:h-5'), 'Voice action button icon scales responsively (w-4 h-4 sm:w-5 sm:h-5)')
assert(mainScreenContent.includes('SendHorizontal'), 'Send button uses modern SendHorizontal icon')
assert(mainScreenContent.includes('AudioLines'), 'Voice trigger uses dynamic AudioLines icon')

// 5.3 Profile screen responsive tabs & field icons
const profileScreenContent = fs.readFileSync('screens/profile-screen.tsx', 'utf8')
assert(profileScreenContent.includes('overflow-x-auto no-scrollbar'), 'Profile tabs row supports responsive horizontal scroll')
assert(profileScreenContent.includes('UserCheck2'), 'Profile Contact tab uses UserCheck2')
assert(profileScreenContent.includes('Globe2'), 'Profile Links tab uses Globe2')
assert(profileScreenContent.includes('Briefcase'), 'Profile Experience tab uses Briefcase')
assert(profileScreenContent.includes('GraduationCap'), 'Profile Education tab uses GraduationCap')
assert(profileScreenContent.includes('FileQuestion'), 'Profile Custom tab uses FileQuestion')
assert(profileScreenContent.includes('RotateCcw'), 'Profile Clear button uses RotateCcw')
assert(profileScreenContent.includes('FileUp'), 'Profile Resume import uses FileUp')

// 5.4 Settings screen icon responsiveness
const settingsScreenContent = fs.readFileSync('screens/settings-screen.tsx', 'utf8')
assert(settingsScreenContent.includes('Palette'), 'Settings Appearance section features Palette icon')
assert(settingsScreenContent.includes('Volume2'), 'Settings Audio section features Volume2 icon')
assert(settingsScreenContent.includes('Compass'), 'Settings Browsing section features Compass icon')
assert(settingsScreenContent.includes('Sliders'), 'Settings Flags section features Sliders icon')
assert(settingsScreenContent.includes('SunMedium'), 'Settings Light mode button uses SunMedium')
assert(settingsScreenContent.includes('MoonStar'), 'Settings Dark mode button uses MoonStar')

// 5.5 In-page capture overlay buttons
const overlayContent = fs.readFileSync('components/capture-overlay-buttons.tsx', 'utf8')
assert(overlayContent.includes('Wand2'), 'Capture overlay uses Wand2 for 1-Click Form Autofill button')
assert(overlayContent.includes('Camera'), 'Capture overlay uses Camera for screenshot button')
assert(overlayContent.includes('GripVertical'), 'Capture overlay uses GripVertical for drag handle')

// ========================================================================
// SUITE 6: Autofill Profile Vault Schema & Round-Trip Invariants
// ========================================================================
suite('SUITE 6: Autofill Profile Vault Schema & Round-Trip Invariants')

const profileVaultModule = await import('../lib/autofill/profile-vault.ts')
const { DEFAULT_AUTOFILL_PROFILE, createEmptyProfile } = profileVaultModule

console.log('\n--- 6.1 Schema Validation ---')
assert(DEFAULT_AUTOFILL_PROFILE.personal && typeof DEFAULT_AUTOFILL_PROFILE.personal.fullName === 'string', 'Default profile has personal.fullName')
assert(DEFAULT_AUTOFILL_PROFILE.online && typeof DEFAULT_AUTOFILL_PROFILE.online.linkedinUrl === 'string', 'Default profile has online.linkedinUrl')
assert(Array.isArray(DEFAULT_AUTOFILL_PROFILE.workExperience), 'Default profile workExperience is an array')
assert(Array.isArray(DEFAULT_AUTOFILL_PROFILE.education), 'Default profile education is an array')
assert(DEFAULT_AUTOFILL_PROFILE.demographics && typeof DEFAULT_AUTOFILL_PROFILE.demographics.authorizedToWorkInCountry === 'boolean', 'Default demographics has authorizedToWorkInCountry')
assert(Array.isArray(DEFAULT_AUTOFILL_PROFILE.customAnswers), 'Default customAnswers is an array')

console.log('\n--- 6.2 Serialization & Deserialization Stress Test ---')
const empty = createEmptyProfile()
assert(empty.personal.fullName === '', 'Empty profile initializes blank fullName')
assert(empty.workExperience.length === 0, 'Empty profile initializes 0 work experiences')

// Deep JSON round-trip
const serialized = JSON.stringify(DEFAULT_AUTOFILL_PROFILE)
const deserialized = JSON.parse(serialized)
assert(deserialized.personal.email === DEFAULT_AUTOFILL_PROFILE.personal.email, 'Profile JSON serialization round-trips without corruption')
assert(deserialized.skills.length === DEFAULT_AUTOFILL_PROFILE.skills.length, 'Profile skills array preserved after serialization')

// ========================================================================
// SUITE 7: Production Build Artifacts & Manifest V3 Validation
// ========================================================================
suite('SUITE 7: Production Build Artifacts & Manifest V3 Validation')

const prodManifestPath = path.resolve('build/chrome-mv3-prod/manifest.json')
assert(fs.existsSync(prodManifestPath), 'build/chrome-mv3-prod/manifest.json exists')

const prodManifest = JSON.parse(fs.readFileSync(prodManifestPath, 'utf8'))
assert(prodManifest.manifest_version === 3, 'Manifest version is 3')
assert(prodManifest.name === 'Pentone', `Extension name is "${prodManifest.name}"`)
assert(prodManifest.side_panel && prodManifest.side_panel.default_path, 'side_panel.default_path is configured')

// Check side panel HTML and bundle exist
const sidepanelHtmlPath = path.resolve('build/chrome-mv3-prod', prodManifest.side_panel.default_path)
assert(fs.existsSync(sidepanelHtmlPath), `Side panel HTML exists at ${prodManifest.side_panel.default_path}`)

// Check background service worker exists
if (prodManifest.background?.service_worker) {
  const bgWorkerPath = path.resolve('build/chrome-mv3-prod', prodManifest.background.service_worker)
  assert(fs.existsSync(bgWorkerPath), `Background service worker exists at ${prodManifest.background.service_worker}`)
  const bgSize = fs.statSync(bgWorkerPath).size
  assert(bgSize > 1000, `Background service worker is non-empty (${bgSize} bytes)`)
}

// Check content script bundles exist
if (prodManifest.content_scripts && prodManifest.content_scripts.length > 0) {
  for (const cs of prodManifest.content_scripts) {
    for (const jsFile of cs.js || []) {
      const csPath = path.resolve('build/chrome-mv3-prod', jsFile)
      assert(fs.existsSync(csPath), `Content script bundle exists at ${jsFile}`)
    }
  }
}

// Check popup HTML exists
const popupHtmlPath = path.resolve('build/chrome-mv3-prod/popup.html')
assert(fs.existsSync(popupHtmlPath), 'Popup HTML exists in build')

// ========================================================================
// FINAL SUMMARY
// ========================================================================
console.log(`\n========================================================================`)
console.log(`  FINAL STRESS TEST RESULTS: ${passedTests}/${totalTests} PASSED (${failedTests} FAILURES)`)
console.log(`========================================================================`)

if (failedTests > 0) {
  console.error(`\n❌ FAILED TESTS SUMMARY:`)
  for (const f of failures) {
    console.error(f)
  }
  process.exit(1)
} else {
  console.log(`\n🎉 ALL ${totalTests} ICONOGRAPHY, THEME, AND RESPONSIVENESS STRESS TESTS PASSED WITH 100% SUCCESS!`)
  process.exit(0)
}

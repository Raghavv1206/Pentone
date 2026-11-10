const fs = require('fs');
const path = require('path');

console.log('[post-build] Starting script...');

const buildDirs = [
  path.join(__dirname, '..', 'build', process.argv.includes('--dev') ? 'chrome-mv3-dev' : 'chrome-mv3-prod')
];

for (const buildDir of buildDirs) {
  console.log(`[post-build] Processing buildDir: ${buildDir}`);
  if (!fs.existsSync(buildDir)) {
    console.log(`[post-build] Directory does not exist, skipping: ${buildDir}`);
    throw new Error('Expected build directory is missing: ' + buildDir);
  }

  // 1. Process manifest.json
  const manifestPath = path.join(buildDir, 'manifest.json');
  console.log(`[post-build] Checking manifest at: ${manifestPath}`);
  if (fs.existsSync(manifestPath)) {
    try {
      const content = fs.readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(content);
      let modified = false;

      // Remove default_popup so Chrome toolbar action opens sidepanel directly
      if (manifest.action && manifest.action.default_popup) {
        delete manifest.action.default_popup;
        modified = true;
        console.log(`[post-build] Removed action.default_popup from ${manifestPath}`);
      }

      // Ensure audioCapture is not in permissions
      if (manifest.permissions && Array.isArray(manifest.permissions)) {
        const initialLen = manifest.permissions.length;
        manifest.permissions = manifest.permissions.filter(p => p !== 'audioCapture');
        if (manifest.permissions.length !== initialLen) {
          modified = true;
          console.log(`[post-build] Removed audioCapture permission from ${manifestPath}`);
        }
      }

      if (modified) {
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        console.log(`[post-build] Updated manifest at ${manifestPath}`);
      }
    } catch (err) {
      process.exitCode = 1;
      console.error(`[post-build] Error processing ${manifestPath}:`, err);
    }
  }

  // 1.5 Ensure assets/ort-wasm is copied to build
  const srcOrtWasm = path.join(__dirname, '..', 'assets', 'ort-wasm');
  const destOrtWasm = path.join(buildDir, 'assets', 'ort-wasm');
  console.log(`[post-build] Checking ort-wasm copy...`);
  if (fs.existsSync(srcOrtWasm)) {
    if (!fs.existsSync(destOrtWasm)) {
      fs.mkdirSync(destOrtWasm, { recursive: true });
    }
    const wasmFiles = fs.readdirSync(srcOrtWasm);
    for (const wFile of wasmFiles) {
      const srcFile = path.join(srcOrtWasm, wFile);
      const destFile = path.join(destOrtWasm, wFile);
      if (fs.statSync(srcFile).isFile()) {
        fs.copyFileSync(srcFile, destFile);
        console.log(`[post-build] Copied ${wFile} to ${destOrtWasm}`);
      }
    }
  }

  // 2. Patch JS bundles to guarantee React mounting even if DOMContentLoaded already fired
  // In Chrome MV3 side panels and popups, small HTML docs finish parsing before large JS bundles run,
  // causing document.addEventListener("DOMContentLoaded", ...) to never trigger.
  const files = fs.readdirSync(buildDir);
  for (const file of files) {
    if (file.endsWith('.js')) {
      const filePath = path.join(buildDir, file);
      try {
        let js = fs.readFileSync(filePath, 'utf8');
        let jsModified = false;

        // 2.1 ReadyState mount patch for sidepanel and popup entrypoints
        if ((file.startsWith('sidepanel') || file.startsWith('popup')) &&
            js.includes('document.addEventListener("DOMContentLoaded",') &&
            !js.includes('document.readyState')) {
          const domLoadedRegex = /document\.addEventListener\("DOMContentLoaded",\s*(\(\)\s*=>\s*\{[\s\S]*?\}\))\)/;
          const match = js.match(domLoadedRegex);
          if (match) {
            js = js.replace(match[0], `((__mountFn)=>{if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",__mountFn)}else{__mountFn()}})(${match[1]})`);
            jsModified = true;
            console.log(`[post-build] Patched reliable instant mount in ${file}`);
          }
        }

        // 3. Patch Parcel tree-shaking bug in property-information (hastToReact stripped -> TypeError: Cannot convert undefined or null to object)
        if (js.includes('"hastToReact"') && !js.includes('classId:"classID"')) {
          let idx = 0;
          while ((idx = js.indexOf('"hastToReact"', idx)) !== -1) {
            const start = Math.max(0, idx - 50);
            const end = Math.min(js.length, idx + 100);
            const slice = js.slice(start, end);
            const regex = /([a-zA-Z0-9_$]+)\.export\(([a-zA-Z0-9_$]+),"hastToReact",\(\)=>([a-zA-Z0-9_$]+)\.hastToReact\)/;
            const match = slice.match(regex);
            if (match) {
              const fullMatch = match[0];
              const repl = `${match[1]}.export(${match[2]},"hastToReact",()=>${match[3]}.hastToReact||({classId:"classID",dataType:"datatype",itemId:"itemID",strokeDashArray:"strokeDasharray",strokeDashOffset:"strokeDashoffset",strokeLineCap:"strokeLinecap",strokeLineJoin:"strokeLinejoin",strokeMiterLimit:"strokeMiterlimit",typeOf:"typeof",xLinkActuate:"xlinkActuate",xLinkArcRole:"xlinkArcrole",xLinkHref:"xlinkHref",xLinkRole:"xlinkRole",xLinkShow:"xlinkShow",xLinkTitle:"xlinkTitle",xLinkType:"xlinkType",xmlnsXLink:"xmlnsXlink"}))`;
              js = js.slice(0, start) + slice.replace(fullMatch, repl) + js.slice(end);
              jsModified = true;
              console.log(`[post-build] Patched property-information hastToReact export in ${file}`);
              break;
            }
            idx += 13;
          }
        }

        if (js.includes('.hastToReact,') && !js.includes('.hastToReact&&')) {
          const idx = js.indexOf('.hastToReact,');
          const start = Math.max(0, idx - 50);
          const end = Math.min(js.length, idx + 120);
          const slice = js.slice(start, end);
          const regex = /([a-zA-Z0-9_$]+)\.call\(([a-zA-Z0-9_$]+)\.hastToReact,([a-zA-Z0-9_$]+)\.property\)\?([a-zA-Z0-9_$]+)\.hastToReact\[([a-zA-Z0-9_$]+)\.property\]:([a-zA-Z0-9_$]+)\.property/;
          const match = slice.match(regex);
          if (match) {
            const fullMatch = match[0];
            const repl = `(${match[2]}.hastToReact&&${match[1]}.call(${match[2]}.hastToReact,${match[3]}.property)?${match[2]}.hastToReact[${match[3]}.property]:${match[3]}.property)`;
            js = js.slice(0, start) + slice.replace(fullMatch, repl) + js.slice(end);
            jsModified = true;
            console.log(`[post-build] Patched hastToReact safe calls in ${file}`);
          }
        }

        if (jsModified) {
          fs.writeFileSync(filePath, js, 'utf8');
        }
      } catch (err) {
      process.exitCode = 1;
        console.error(`[post-build] Error patching ${file}:`, err);
      }
    }
  }

  // 4. Inject Instant Zero-Latency HTML/CSS Splash Loader into sidepanel.html and popup.html
  const htmlFiles = ['sidepanel.html', 'popup.html'];
  const splashHTML = `
<div class="pentone-splash-root">
  <div class="pentone-splash-header">
    <div class="pentone-splash-brand">
      <div class="pentone-splash-logo">P</div>
      <span class="pentone-splash-title">Pentone</span>
    </div>
    <div style="width:7px;height:7px;border-radius:50%;background:#67E2C8;box-shadow:0 0 8px #67E2C8;"></div>
  </div>
  <div class="pentone-splash-body">
    <div class="pentone-orb-wrap">
      <div class="pentone-orb-ripple"></div>
      <div class="pentone-orb">
        <svg class="pentone-orb-mic" viewBox="0 0 24 24">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" x2="12" y1="19" y2="22"/>
        </svg>
      </div>
    </div>
    <div class="pentone-splash-status">
      <span class="pentone-splash-status-text">Starting AI Copilot...</span>
      <div class="pentone-shimmer-bar"></div>
    </div>
  </div>
  <div class="pentone-splash-footer">
    <span>On-device AI &bull; Local profile storage</span>
  </div>
</div>
  `.trim();

  const splashCSS = `
<meta name="color-scheme" content="dark">
<style>
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    background-color: #171816 !important;
    color: #F5F1E7;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    overflow: hidden;
  }
  @keyframes pPulse {
    0%, 100% { transform: scale(0.96); opacity: 0.85; }
    50% { transform: scale(1.04); opacity: 1; }
  }
  @keyframes pRipple {
    0% { transform: scale(0.8); opacity: 0.7; }
    100% { transform: scale(1.4); opacity: 0; }
  }
  @keyframes pShimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
  @keyframes pFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .pentone-splash-root {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100vh;
    background-color: #171816;
    animation: pFadeIn 0.15s ease-out;
    box-sizing: border-box;
    user-select: none;
  }
  .pentone-splash-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(55, 56, 50, 0.6);
  }
  .pentone-splash-brand {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .pentone-splash-logo {
    width: 20px;
    height: 20px;
    border-radius: 6px;
    background: #005447;
    border: 1px solid #67E2C8;
    box-shadow: 0 0 10px rgba(103, 226, 200, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 800;
    color: #67E2C8;
  }
  .pentone-splash-title {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: #F5F1E7;
  }
  .pentone-splash-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
    padding: 24px;
  }
  .pentone-orb-wrap {
    position: relative;
    width: 110px;
    height: 110px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .pentone-orb-ripple {
    position: absolute;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    border: 1px solid rgba(103, 226, 200, 0.4);
    animation: pRipple 2.2s cubic-bezier(0.16, 1, 0.3, 1) infinite;
  }
  .pentone-orb {
    width: 84px;
    height: 84px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, #005447 0%, #003F36 60%, #171816 100%);
    border: 1.5px solid #67E2C8;
    box-shadow: 0 0 28px rgba(103, 226, 200, 0.35), inset 0 0 16px rgba(103, 226, 200, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: pPulse 2s ease-in-out infinite;
  }
  .pentone-orb-mic {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: #67E2C8;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .pentone-splash-status {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    text-align: center;
  }
  .pentone-splash-status-text {
    font-size: 12.5px;
    font-weight: 600;
    color: #DDDCCB;
  }
  .pentone-shimmer-bar {
    width: 140px;
    height: 3px;
    border-radius: 3px;
    background: linear-gradient(90deg, rgba(103, 226, 200, 0.1) 0%, rgba(103, 226, 200, 0.8) 50%, rgba(103, 226, 200, 0.1) 100%);
    background-size: 200% 100%;
    animation: pShimmer 1.4s ease-in-out infinite;
  }
  .pentone-splash-footer {
    padding: 12px 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-top: 1px solid rgba(55, 56, 50, 0.5);
    font-size: 10px;
    color: #77776E;
  }
</style>
  `.trim();

  for (const htmlFile of htmlFiles) {
    const htmlPath = path.join(buildDir, htmlFile);
    if (fs.existsSync(htmlPath)) {
      try {
        let html = fs.readFileSync(htmlPath, 'utf8');
        // Inject splash CSS into <head>
        if (!html.includes('pentone-splash-root')) {
          html = html.replace('</head>', `${splashCSS}</head>`);
          html = html.replace(/<div id="__plasmo">\s*<\/div>/, `<div id="__plasmo">${splashHTML}</div>`);
          fs.writeFileSync(htmlPath, html, 'utf8');
          console.log(`[post-build] Injected instant splash loader into ${htmlFile}`);
        }
      } catch (err) {
      process.exitCode = 1;
        console.error(`[post-build] Error injecting splash loader into ${htmlFile}:`, err);
      }
    }
  }
}

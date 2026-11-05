const fs = require('fs');
const path = require('path');

const buildDirs = [
  path.join(__dirname, '..', 'build', 'chrome-mv3-prod'),
  path.join(__dirname, '..', 'build', 'chrome-mv3-dev')
];

for (const buildDir of buildDirs) {
  if (!fs.existsSync(buildDir)) continue;

  // 1. Process manifest.json
  const manifestPath = path.join(buildDir, 'manifest.json');
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
      console.error(`[post-build] Error processing ${manifestPath}:`, err);
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
        const domLoadedRegex = /document\.addEventListener\("DOMContentLoaded",\s*(\(\)\s*=>\s*\{[\s\S]*?\}\))\)/g;
        if (domLoadedRegex.test(js)) {
          js = js.replace(domLoadedRegex, '((__mountFn)=>{if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",__mountFn)}else{__mountFn()}})($1)');
          fs.writeFileSync(filePath, js, 'utf8');
          console.log(`[post-build] Patched reliable instant mount in ${file}`);
        }

        // 3. Patch Parcel tree-shaking bug in property-information (hastToReact stripped -> TypeError: Cannot convert undefined or null to object)
        const hastToReactExportRegex = /i\.export\(r,"hastToReact",\(\)=>([a-zA-Z0-9_$]+)\.hastToReact\)/g;
        if (hastToReactExportRegex.test(js)) {
          js = js.replace(hastToReactExportRegex, 'var __h2r={classId:"classID",dataType:"datatype",itemId:"itemID",strokeDashArray:"strokeDasharray",strokeDashOffset:"strokeDashoffset",strokeLineCap:"strokeLinecap",strokeLineJoin:"strokeLinejoin",strokeMiterLimit:"strokeMiterlimit",typeOf:"typeof",xLinkActuate:"xlinkActuate",xLinkArcRole:"xlinkArcrole",xLinkHref:"xlinkHref",xLinkRole:"xlinkRole",xLinkShow:"xlinkShow",xLinkTitle:"xlinkTitle",xLinkType:"xlinkType",xmlnsXLink:"xmlnsXlink"};i.export(r,"hastToReact",()=>$1.hastToReact||__h2r)');
          fs.writeFileSync(filePath, js, 'utf8');
          console.log(`[post-build] Patched property-information hastToReact export in ${file}`);
        }

        const hastToReactCallRegex = /([a-zA-Z0-9_$]+)\.call\(([a-zA-Z0-9_$]+)\.hastToReact,([a-zA-Z0-9_$]+)\.property\)\?([a-zA-Z0-9_$]+)\.hastToReact\[([a-zA-Z0-9_$]+)\.property\]:([a-zA-Z0-9_$]+)\.property/g;
        if (hastToReactCallRegex.test(js)) {
          js = js.replace(hastToReactCallRegex, '($2.hastToReact&&$1.call($2.hastToReact,$3.property)?$2.hastToReact[$3.property]:$3.property)');
          fs.writeFileSync(filePath, js, 'utf8');
          console.log(`[post-build] Patched hastToReact safe calls in ${file}`);
        }
      } catch (err) {
        console.error(`[post-build] Error patching ${file}:`, err);
      }
    }
  }
}

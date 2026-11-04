const fs = require('fs');
const path = require('path');

const manifestPaths = [
  path.join(__dirname, '..', 'build', 'chrome-mv3-prod', 'manifest.json'),
  path.join(__dirname, '..', 'build', 'chrome-mv3-dev', 'manifest.json')
];

for (const manifestPath of manifestPaths) {
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
}

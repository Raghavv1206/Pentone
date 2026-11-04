const fs = require('fs');
const path = require('path');

const prodDir = path.resolve(__dirname, '../build/chrome-mv3-prod');
if (!fs.existsSync(prodDir)) {
  console.log('[patch-bundle] Build dir not found, skipping.');
  process.exit(0);
}

// 1. Patch transformers.*.js to restore native dynamic import for WASM/JSEP modules
const files = fs.readdirSync(prodDir);
for (const file of files) {
  if (file.startsWith('transformers.') && file.endsWith('.js')) {
    const fullPath = path.join(prodDir, file);
    let code = fs.readFileSync(fullPath, 'utf8');
    
    // Target Parcel dynamic import rewrite: async r=>(await t(r)).default
    const dynamicImportRegex = /async\s+([a-zA-Z0-9_$]+)=>\(await\s+([a-zA-Z0-9_$]+)\(\1\)\)\.default/;
    const match = code.match(dynamicImportRegex);
    if (match) {
      console.log(`[patch-bundle] Found Parcel dynamic import rewrite in ${file}: ${match[0]}`);
      const replacement = `async ${match[1]}=>(await import(${match[1]})).default`;
      code = code.replace(match[0], replacement);
      fs.writeFileSync(fullPath, code, 'utf8');
      console.log(`[patch-bundle] Successfully restored native dynamic import in ${file}!`);
    } else {
      console.log(`[patch-bundle] No rewrite pattern matched in ${file}`);
    }
  }
}

// 2. Ensure WASM files exist in build/chrome-mv3-prod/assets/
const assetsDir = path.join(prodDir, 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

const ortDist = path.resolve(__dirname, '../node_modules/.pnpm/onnxruntime-web@1.31.1/node_modules/onnxruntime-web/dist');
const wasmFiles = [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm'
];

for (const wf of wasmFiles) {
  const destPath = path.join(assetsDir, wf);
  const srcPath = path.join(ortDist, wf);
  if (fs.existsSync(srcPath) && (!fs.existsSync(destPath) || fs.statSync(destPath).size === 0)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`[patch-bundle] Copied ${wf} to build assets.`);
  }
}

// 3. Ensure pentone-audio-processor.js exists in build assets
const processorSrc = path.resolve(__dirname, '../assets/pentone-audio-processor.js');
const processorDest = path.join(assetsDir, 'pentone-audio-processor.js');
if (fs.existsSync(processorSrc)) {
  fs.copyFileSync(processorSrc, processorDest);
  console.log('[patch-bundle] Copied pentone-audio-processor.js to build assets.');
}

console.log('[patch-bundle] Complete.');

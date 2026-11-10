const path = require("node:path")
const { buildSync } = require("esbuild")
const root = path.resolve(__dirname, "..")
const destination = process.argv.includes("--test")
  ? "tests/evidence"
  : `build/chrome-mv3-${process.argv.includes("--dev") ? "dev" : "prod"}`
buildSync({
  entryPoints: [path.join(root, "lib/browser/page-agent.ts")],
  outfile: path.join(root, destination, "pentone-page-agent.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  minify: !process.argv.includes("--test")
})

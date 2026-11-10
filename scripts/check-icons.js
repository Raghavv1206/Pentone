const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat && stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'build' && file !== '.gemini') {
        results = results.concat(walk(full));
      }
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      results.push(full);
    }
  });
  return results;
}

const files = walk('.');
const iconUsage = {};

files.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  const imports = lines.filter(l => l.includes('lucide-react') || l.includes('react-icons') || l.includes('@radix-ui/react-icons'));
  if (imports.length > 0) {
    iconUsage[f] = imports.map(i => i.trim());
  }
});

console.log(JSON.stringify(iconUsage, null, 2));

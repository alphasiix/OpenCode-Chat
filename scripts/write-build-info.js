// Génère src/build-info.json avant chaque build : version + commit + date.
// L'app compare la date du build embarqué avec celle de l'asset
// de la release "latest" pour décider d'afficher la popup de mise à jour.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

let commit = 'dev';
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'dev';
} catch {}

const info = {
  version: pkg.version,
  commit,
  date: new Date().toISOString()
};

fs.writeFileSync(path.join(root, 'src', 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
console.log('[build-info]', JSON.stringify(info));

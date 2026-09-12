const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const http = require('http');

let mainWindow = null;
let opencodeProcess = null;
let serverPort = 4096;
let serverHostname = '127.0.0.1';

function getServerUrl() {
  return `http://${serverHostname}:${serverPort}`;
}

function checkServerAlive(port, hostname) {
  return new Promise((resolve) => {
    const req = http.get(`http://${hostname}:${port}/global/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function tryFindServer() {
  // Try default 4096, then 4097-4110
  for (let p = 4096; p <= 4115; p++) {
    if (await checkServerAlive(p, '127.0.0.1')) {
      serverPort = p;
      console.log(`[OpenCode] Serveur trouvé sur port ${p}`);
      return true;
    }
  }
  return false;
}

function startOpencodeServer() {
  return new Promise(async (resolve) => {
    const found = await tryFindServer();
    if (found) {
      resolve(true);
      return;
    }
    console.log('[OpenCode] Démarrage de opencode serve...');
    // Try direct opencode binary first, fallback to npx
    const { execSync } = require('child_process');
    let opencodeCmd = 'opencode';
    let opencodeArgs = ['serve', '--port', String(serverPort), '--hostname', serverHostname];
    // On Windows, npm bin is in AppData\Roaming\npm
    try {
      const npmBin = execSync('where opencode', { encoding: 'utf8', windowsHide: true }).split('\n')[0].trim();
      if (npmBin) {
        // if .ps1, use .cmd or exe directly
        if (npmBin.endsWith('.ps1')) {
          const exePath = npmBin.replace('.ps1', '.cmd');
          if (fs.existsSync(exePath)) opencodeCmd = exePath;
          else opencodeCmd = 'opencode';
        } else {
          opencodeCmd = npmBin;
        }
      }
    } catch {}
    // Fallback: try local node_modules/.bin
    if (opencodeCmd === 'opencode') {
      const localBin = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'opencode.cmd' : 'opencode');
      if (fs.existsSync(localBin)) opencodeCmd = localBin;
      const altBin = path.join(require('os').homedir(), 'AppData', 'Roaming', 'npm', 'opencode.cmd');
      if (fs.existsSync(altBin) && opencodeCmd === 'opencode') opencodeCmd = altBin;
      const exeBin = path.join(require('os').homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
      if (fs.existsSync(exeBin)) { opencodeCmd = exeBin; opencodeArgs = ['serve', '--port', String(serverPort), '--hostname', serverHostname]; }
    }
    console.log(`[OpenCode] Commande: ${opencodeCmd} ${opencodeArgs.join(' ')}`);
    try {
      opencodeProcess = spawn(opencodeCmd, opencodeArgs, {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: true,
        env: process.env
      });
    } catch (e) {
      console.error('[opencode] spawn sync error', e);
      resolve(false);
      return;
    }

    let resolved = false;
    const done = (ok) => { if (!resolved) { resolved = true; resolve(ok); } };

    opencodeProcess.stdout.on('data', (d) => console.log('[opencode]', d.toString().trim()));
    opencodeProcess.stderr.on('data', (d) => console.log('[opencode:err]', d.toString().trim()));
    opencodeProcess.on('error', (e) => {
      console.error('[opencode] spawn error', e);
      done(false);
    });
    opencodeProcess.on('exit', (code) => {
      console.log('[opencode] exit', code);
    });

    // Poll for readiness 15s
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      const alive = await checkServerAlive(serverPort, serverHostname);
      if (alive) {
        clearInterval(interval);
        console.log('[OpenCode] Serveur prêt');
        done(true);
      } else if (attempts > 30) {
        clearInterval(interval);
        console.log('[OpenCode] Timeout attente serveur');
        done(false);
      }
    }, 500);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1050,
    minHeight: 650,
    backgroundColor: '#1a1a1e',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    show: false,
    icon: fs.existsSync(path.join(__dirname, '../assets/icon.png')) ? path.join(__dirname, '../assets/icon.png') : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../src/index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // DevTools en --dev
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

// IPC handlers
ipcMain.handle('get-server-config', async () => {
  return { port: serverPort, hostname: serverHostname, url: getServerUrl() };
});

ipcMain.handle('set-server-config', async (_e, cfg) => {
  if (cfg.port) serverPort = Number(cfg.port);
  if (cfg.hostname) serverHostname = cfg.hostname;
  const alive = await checkServerAlive(serverPort, serverHostname);
  return { ok: alive, url: getServerUrl() };
});

ipcMain.handle('check-server', async () => {
  const alive = await checkServerAlive(serverPort, serverHostname);
  return { alive, url: getServerUrl() };
});

ipcMain.handle('restart-server', async () => {
  if (opencodeProcess) {
    try { opencodeProcess.kill(); } catch {}
    opencodeProcess = null;
  }
  await new Promise(r => setTimeout(r, 800));
  const ok = await startOpencodeServer();
  return { ok, url: getServerUrl() };
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('get-workdir', () => {
  return process.cwd();
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-build-info', () => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '../src/build-info.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
});

ipcMain.handle('open-external', async (_e, url) => {
  shell.openExternal(url);
});

app.whenReady().then(async () => {
  await startOpencodeServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (opencodeProcess) {
    try { opencodeProcess.kill(); } catch {}
  }
});

// Security: deny navigation
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });
});

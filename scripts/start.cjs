const { spawn } = require('node:child_process');
const path = require('node:path');
// Honor the Windows trust store, including corporate certificates, without disabling TLS.
if (process.platform === 'win32') process.env.NODE_USE_SYSTEM_CA ??= '1';
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(__dirname, '..'), ...process.argv.slice(2)], {
  stdio: 'inherit', env, windowsHide: false
});
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 0; });

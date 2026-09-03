const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const healthUrl = 'http://127.0.0.1:8090/api/health';

function isPocketBaseRunning() {
  return new Promise((resolve) => {
    const request = http.get(healthUrl, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });

    request.setTimeout(2_000, () => {
      request.destroy();
      resolve(false);
    });

    request.on('error', () => resolve(false));
  });
}

async function startPocketBase() {
  if (await isPocketBaseRunning()) {
    console.log('PocketBase is already running on port 8090.');
    return;
  }

  const executable = process.platform === 'win32'
    ? path.join(__dirname, '..', 'pocketbase.exe')
    : path.join(__dirname, '..', 'pocketbase');
  const pocketBase = spawn(executable, ['serve'], { stdio: 'inherit' });

  pocketBase.on('error', (error) => {
    console.error(`PocketBase could not be started: ${error.message}`);
    process.exitCode = 1;
  });

  pocketBase.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

startPocketBase();
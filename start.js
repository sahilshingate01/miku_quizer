#!/usr/bin/env node

/**
 * 🎵 Miku Quizer - Universal Root Runner
 * Run from anywhere with: node start.js (or npm start)
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.join(__dirname, 'backend');

console.log('======================================================');
echoBanner();

function echoBanner() {
  console.log('  🎵 Miku Quizer - AI Backend Server');
  console.log('  🌐 API Server: http://localhost:3001');
  console.log('  🧠 AI Engine:  GPT-5.4 via OpenAI OAuth');
  console.log('======================================================\n');
}

console.log('📦 [1/2] Checking dependencies (npm install)...');
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

const install = spawn(npmCmd, ['install'], {
  cwd: backendDir,
  stdio: 'inherit'
});

install.on('close', (code) => {
  console.log('\n🚀 [2/2] Starting Miku Quizer Server...');
  const server = spawn('node', ['server.js'], {
    cwd: backendDir,
    stdio: 'inherit'
  });

  server.on('close', (srvCode) => {
    process.exit(srvCode || 0);
  });
});

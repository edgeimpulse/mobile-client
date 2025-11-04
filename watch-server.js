// Watches the client directory
// This script is in JS, not in TS - as we run it _before_ the TypeScript compiler runs

const chokidar = require('chokidar');
const { spawn } = require('child_process');
const Path = require('path');

let command = [
    '--inspect=0.0.0.0:9559',
    '--trace-warnings',
    'build/server/start.js'
];

let nodeProcess;
let isBuilding = false;

function getTimeStr() {
    return new Date().toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: true });
}

function runTscBuild() {
    return new Promise((resolve, reject) => {
        isBuilding = true;
        const tsc = spawn(Path.join(__dirname, './node_modules/.bin/tsc'), ['--build', 'server', '--incremental'], { stdio: 'inherit' });
        tsc.on('exit', (code) => {
            isBuilding = false;

            if (code === 0) {
                resolve();
            }
            else {
                reject(new Error(`Compilation failed with code ${code}`));
            }
        });
    });
}

function runNode() {
    const startProcess = () => {
        nodeProcess = spawn('node', command, { stdio: 'inherit' });
    };

    // Kill any existing process and wait for it to exit
    if (nodeProcess) {
        nodeProcess.once('close', startProcess);
        nodeProcess.kill();
        nodeProcess = null;
    } else {
        startProcess();
    }
}

// Watch TS files
chokidar.watch([
    'server/',
], {
    ignoreInitial: true, ignored: 'build/**'
}).on('change', async (path) => {
    if (!path.endsWith('.ts')) return;

    if (isBuilding) {
        console.log(`${getTimeStr()} - (server) File changed: ${path}, but rebuild already in progress (ignoring)`);
        return;
    }

    console.log(``);
    console.log(`${getTimeStr()} - (server) File changed: ${path}. Rebuilding...`);
    try {
        await runTscBuild();
        console.log(``);
        console.log(`${getTimeStr()} - (server) \x1b[32mCompilation done, restarting server...\x1b[0m`);
        console.log(``);
        runNode();
    }
    catch (ex) {
        console.error(`\x1b[0m${getTimeStr()} - (server) \x1b[31mBuild failed:`, ex.message || ex.toString(), '\x1b[0m');
    }
});

// Initial build + server start
(async () => {
    try {
        console.log(`${getTimeStr()} - (server) Starting incremental compilation...`);
        await runTscBuild();
        console.log(``);
        console.log(`${getTimeStr()} - (server) \x1b[32mCompilation done, starting server...\x1b[0m`);
        console.log(``);
        runNode();
    }
    catch (ex) {
        console.error(`\x1b[0m${getTimeStr()} - (server) \x1b[31mBuild failed:`, ex.message || ex.toString(), '\x1b[0m');
    }
})();

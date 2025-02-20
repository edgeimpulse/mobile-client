// Watches the client directory
// This script is in JS, not in TS - as we run it _before_ the TypeScript compiler runs

const chokidar = require('chokidar');
const { spawn } = require('child_process');
const Path = require('path');

let isBuilding = false;

function getTimeStr() {
    return new Date().toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: true });
}

function runTscBuild() {
    return new Promise((resolve, reject) => {
        isBuilding = true;
        const tsc = spawn(Path.join(__dirname, './node_modules/.bin/tsc'), ['--build', 'client', '--incremental'], { stdio: 'inherit' });
        tsc.on('exit', (code) => {
            isBuilding = false;

            if (code === 0) {
                resolve();
            }
            else {
                reject(new Error(`${getTimeStr()} - (client) Compilation failed with code ${code}`));
            }
        });
    });
}

// Watch TS files
chokidar.watch([
    'client/',
], {
    ignoreInitial: true, ignored: 'build/**'
}).on('change', async (path) => {
    if (!path.endsWith('.ts')) return;

    if (isBuilding) {
        console.log(`${getTimeStr()} - (client) File changed: ${path}, but rebuild already in progress (ignoring)`);
        return;
    }

    console.log(``);
    console.log(`${getTimeStr()} - (client) File changed: ${path}. Rebuilding client...`);
    try {
        await runTscBuild();
        console.log(``);
        console.log(`${getTimeStr()} - (client) \x1b[32mCompilation done\x1b[0m`);
    }
    catch (ex) {
        console.error(`\x1b[0m${getTimeStr()} - (client) \x1b[31mBuild failed:`, ex.message || ex.toString(), '\x1b[0m');
    }
});

// Initial build
(async () => {
    try {
        console.log(`${getTimeStr()} - (client) Starting incremental compilation...`);
        await runTscBuild();
        console.log(``);
        console.log(`${getTimeStr()} - (client) \x1b[32mCompilation done\x1b[0m`);
    }
    catch (ex) {
        console.error(`\x1b[0m${getTimeStr()} - (client) \x1b[31mBuild failed:`, ex.message || ex.toString(), '\x1b[0m');
    }
})();

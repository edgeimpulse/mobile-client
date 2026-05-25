// Watches the client directory
// This script is in JS, not in TS - as we run it _before_ the TypeScript compiler runs

const chokidar = require('chokidar');
const { spawn } = require('child_process');
const Path = require('path');

let isBuilding = false;

function getTimeStr() {
    return new Date().toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: true });
}

function runProcess(command, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: 'inherit' });
        child.on('exit', (code) => {
            if (code === 0) {
                resolve();
            }
            else {
                reject(new Error(`${getTimeStr()} - (client) Compilation failed with code ${code}`));
            }
        });
    });
}

async function runClientBuild() {
    isBuilding = true;
    try {
        await runProcess(Path.join(__dirname, './node_modules/.bin/tsgo'),
            ['-p', 'client/tsconfig.json', '--incremental']);
        await runProcess('node', [Path.join(__dirname, 'build-client-amd.js')]);
    }
    finally {
        isBuilding = false;
    }
}

// Watch TS files
chokidar.watch([
    'client/',
    'js-libs/',
    'build-client-amd.js',
], {
    ignoreInitial: true,
    ignored: 'build/**',
}).on('all', async (event, path) => {
    if (isBuilding) {
        console.log(`${getTimeStr()} - (client) File changed: ${path}, but rebuild already in progress (ignoring)`);
        return;
    }

    console.log(``);
    console.log(`${getTimeStr()} - (client) File ${event}: ${path}. Rebuilding client...`);
    try {
        await runClientBuild();
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
        await runClientBuild();
        console.log(``);
        console.log(`${getTimeStr()} - (client) \x1b[32mCompilation done\x1b[0m`);
    }
    catch (ex) {
        console.error(`\x1b[0m${getTimeStr()} - (client) \x1b[31mBuild failed:`, ex.message || ex.toString(), '\x1b[0m');
    }
})();

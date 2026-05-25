const fs = require('fs');
const Path = require('path');

const rootDir = __dirname;
const clientBuildDir = Path.join(rootDir, 'build', 'client');
const outputFile = Path.join(rootDir, 'public', 'build', 'client', 'bundle.js');
const outputMapFile = Path.join(rootDir, 'public', 'build', 'client', 'bundle.js.map');
const entryModuleId = 'client/init';

function walkFiles(dir) {
    if (!fs.existsSync(dir)) {
        return [];
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = Path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkFiles(fullPath));
        }
        else {
            files.push(fullPath);
        }
    }

    return files.sort();
}

function toPosixPath(filePath) {
    return filePath.split(Path.sep).join('/');
}

function getVendorFiles() {
    return [
        Path.join(rootDir, 'js-libs', 'almond.js'),
        Path.join(rootDir, 'js-libs', 'cbor.js'),
        ...walkFiles(Path.join(rootDir, 'js-libs', 'ziplib')).filter(file => file.endsWith('.js')),
        Path.join(rootDir, 'js-libs', 'jquery.min.js'),
        Path.join(rootDir, 'js-libs', 'bootstrap-notify.js'),
        Path.join(rootDir, 'js-libs', 'wasm-feature-detect.js'),
    ];
}

function getClientModuleFiles() {
    return walkFiles(clientBuildDir)
        .filter(file => file.endsWith('.js'))
        .filter(file => !file.endsWith('.d.ts.js'));
}

function getModuleId(filePath) {
    const relative = toPosixPath(Path.relative(clientBuildDir, filePath)).replace(/\.js$/, '');
    return `client/${relative}`;
}

function stripSourceMapComment(contents) {
    return contents.replace(/\n\/\/# sourceMappingURL=.*$/m, '');
}

function rewriteDirectoryRequires(filePath, contents) {
    return contents.replace(/require\("(\.[^"]+)"\)/g, (match, specifier) => {
        const resolvedPath = Path.resolve(Path.dirname(filePath), specifier);
        const directFile = `${resolvedPath}.js`;
        const indexFile = Path.join(resolvedPath, 'index.js');

        if (fs.existsSync(directFile) || !fs.existsSync(indexFile)) {
            return match;
        }

        return `require(${JSON.stringify(`${specifier}/index`)})`;
    });
}

function resolveModuleId(fromFilePath, specifier) {
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const resolvedPath = Path.resolve(Path.dirname(fromFilePath), specifier);
        const directFile = `${resolvedPath}.js`;
        const indexFile = Path.join(resolvedPath, 'index.js');

        if (fs.existsSync(directFile)) {
            return getModuleId(directFile);
        }

        if (fs.existsSync(indexFile)) {
            return getModuleId(indexFile);
        }

        return null;
    }

    if (specifier.startsWith('client/')) {
        return specifier;
    }

    return null;
}

function getModuleDependencies(filePath, contents) {
    const dependencies = new Set();

    for (const match of contents.matchAll(/require\("([^"]+)"\)/g)) {
        const resolved = resolveModuleId(filePath, match[1]);
        if (resolved) {
            dependencies.add(resolved);
        }
    }

    return Array.from(dependencies);
}

function getModuleContents(filePath) {
    return rewriteDirectoryRequires(filePath, stripSourceMapComment(readFile(filePath)));
}

function wrapAmdModule(filePath) {
    const moduleId = getModuleId(filePath);
    const contents = getModuleContents(filePath);
    return `define(${JSON.stringify(moduleId)}, ["require", "exports"], function (require, exports) {\n${contents}\n});`;
}

function readFile(filePath) {
    return fs.readFileSync(filePath, 'utf-8').replace(/\n$/, '');
}

function getRebasedSourcePath(mapFilePath, sourceRoot, sourcePath) {
    if (/^(?:[a-z]+:)?\/\//i.test(sourcePath) || sourcePath.startsWith('data:')) {
        return sourcePath;
    }

    const originalSourcePath = sourceRoot
        ? Path.resolve(Path.dirname(mapFilePath), sourceRoot, sourcePath)
        : Path.resolve(Path.dirname(mapFilePath), sourcePath);

    return toPosixPath(Path.relative(Path.dirname(outputMapFile), originalSourcePath));
}

function getModuleSourceMap(filePath) {
    const mapFilePath = `${filePath}.map`;
    if (!fs.existsSync(mapFilePath)) {
        return null;
    }

    const map = JSON.parse(fs.readFileSync(mapFilePath, 'utf-8'));
    const sourceRoot = typeof map.sourceRoot === 'string' ? map.sourceRoot : '';

    map.file = Path.basename(outputFile);
    map.sources = (map.sources || []).map(source => getRebasedSourcePath(mapFilePath, sourceRoot, source));
    delete map.sourceRoot;

    return map;
}

function buildModuleGraph() {
    const moduleGraph = new Map();

    for (const filePath of getClientModuleFiles()) {
        const contents = getModuleContents(filePath);
        moduleGraph.set(getModuleId(filePath), {
            filePath,
            dependencies: getModuleDependencies(filePath, contents),
        });
    }

    return moduleGraph;
}

function getReachableModuleFiles(moduleGraph, entrypoint) {
    if (!moduleGraph.has(entrypoint)) {
        throw new Error(`Bundle entrypoint ${entrypoint} was not found in ${clientBuildDir}.`);
    }

    const reachable = new Set();
    const queue = [entrypoint];

    while (queue.length > 0) {
        const moduleId = queue.shift();
        if (!moduleId || reachable.has(moduleId)) {
            continue;
        }

        reachable.add(moduleId);

        const moduleInfo = moduleGraph.get(moduleId);
        if (!moduleInfo) {
            throw new Error(`Module ${moduleId} was referenced but not found in the client build output.`);
        }

        for (const dependency of moduleInfo.dependencies) {
            if (!reachable.has(dependency)) {
                queue.push(dependency);
            }
        }
    }

    return Array.from(reachable)
        .map(moduleId => moduleGraph.get(moduleId).filePath)
        .sort();
}

function buildBundle() {
    if (!fs.existsSync(clientBuildDir)) {
        throw new Error(`Client build output not found at ${clientBuildDir}. Run tsgo first.`);
    }

    const moduleGraph = buildModuleGraph();
    const sourcemap = {
        version: 3,
        file: Path.basename(outputFile),
        sections: [],
    };
    const bundleLines = [];

    for (const file of getVendorFiles()) {
        if (bundleLines.length > 0) {
            bundleLines.push('', '');
        }
        bundleLines.push(...readFile(file).split('\n'));
    }

    for (const file of getReachableModuleFiles(moduleGraph, entryModuleId)) {
        if (bundleLines.length > 0) {
            bundleLines.push('', '');
        }

        const moduleStartLine = bundleLines.length;

        bundleLines.push(...wrapAmdModule(file).split('\n'));

        const moduleMap = getModuleSourceMap(file);
        if (moduleMap) {
            sourcemap.sections.push({
                offset: {
                    line: moduleStartLine + 1,
                    column: 0,
                },
                map: moduleMap,
            });
        }
    }

    fs.mkdirSync(Path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputMapFile, JSON.stringify(sourcemap));
    fs.writeFileSync(outputFile, `${bundleLines.join('\n')}\n//# sourceMappingURL=${Path.basename(outputMapFile)}\n`);
}

buildBundle();

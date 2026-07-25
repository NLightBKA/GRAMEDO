// Script to copy WASM files from node_modules to resources/wasm/
const fs = require('fs');
const path = require('path');

const destDir = path.join(__dirname, '..', 'resources', 'wasm');
fs.mkdirSync(destDir, { recursive: true });

// web-tree-sitter's main WASM binary
const wasmSrc = path.join(__dirname, '..', 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm');
if (fs.existsSync(wasmSrc)) {
    fs.copyFileSync(wasmSrc, path.join(destDir, 'tree-sitter.wasm'));
    console.log('Copied: tree-sitter.wasm');
} else {
    console.warn('WARNING: tree-sitter.wasm not found at', wasmSrc);
}

// Language-specific WASM grammars
const grammars = [
    { src: 'tree-sitter-wasms/out/tree-sitter-python.wasm',     dest: 'tree-sitter-python.wasm' },
    { src: 'tree-sitter-wasms/out/tree-sitter-java.wasm',       dest: 'tree-sitter-java.wasm'   },
    { src: 'tree-sitter-wasms/out/tree-sitter-c_sharp.wasm',    dest: 'tree-sitter-c_sharp.wasm'},
    { src: 'tree-sitter-wasms/out/tree-sitter-cpp.wasm',        dest: 'tree-sitter-cpp.wasm'    },
    { src: 'tree-sitter-wasms/out/tree-sitter-javascript.wasm', dest: 'tree-sitter-javascript.wasm' },
    { src: 'tree-sitter-wasms/out/tree-sitter-typescript.wasm', dest: 'tree-sitter-typescript.wasm' },
];

for (const { src, dest } of grammars) {
    const srcPath = path.join(__dirname, '..', 'node_modules', src);
    const destPath = path.join(destDir, dest);
    if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`Copied: ${dest}`);
    } else {
        console.warn(`WARNING: Grammar not found: ${src}`);
    }
}

console.log('WASM copy complete.');

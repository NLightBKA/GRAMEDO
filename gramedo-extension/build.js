// esbuild configuration for GRAMEDO VS Code Extension
const esbuild = require('esbuild');
const path = require('path');

const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
    entryPoints: ['./src/extension.ts'],
    bundle: true,
    outfile: './out/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: !isProduction,
    minify: isProduction,
    // Treat WASM files as external assets (not bundled into JS)
    loader: {
        '.wasm': 'file',
    },
    // Don't bundle these – they need the filesystem
    define: {
        'process.env.NODE_ENV': isProduction ? '"production"' : '"development"',
    },
};

async function main() {
    if (isWatch) {
        const ctx = await esbuild.context(buildOptions);
        await ctx.watch();
        console.log('[GRAMEDO] Watching for changes...');
    } else {
        await esbuild.build(buildOptions);
        console.log('[GRAMEDO] Build complete.');
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

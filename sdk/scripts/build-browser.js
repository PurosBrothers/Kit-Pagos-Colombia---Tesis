const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

async function build() {
  const rootDir = path.join(__dirname, '..');
  
  // 1. Bundle del módulo browser en formato ESM nativo
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src-browser', 'index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2020',
    outfile: path.join(rootDir, 'dist', 'browser', 'index.js'),
  });

  // 2. Exportación de definiciones TypeScript limpias en dist/browser/index.d.ts
  const dtsPath = path.join(rootDir, 'dist', 'browser', 'index.d.ts');
  fs.writeFileSync(dtsPath, 'export * from "./src-browser/index";\n');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});

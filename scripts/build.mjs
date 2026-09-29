import nodeFs from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { build, context } from 'esbuild';

const rootDir = process.cwd();
const buildDir = path.join(rootDir, 'build');
const generatedDir = path.join(rootDir, 'src', 'generated');

async function ensureDirs() {
  await fs.mkdir(buildDir, { recursive: true });
  await fs.mkdir(generatedDir, { recursive: true });
}

function escapeForJsonString(value) {
  return JSON.stringify(value);
}

async function writeUiEmbed() {
  const templatePath = path.join(rootDir, 'src', 'ui', 'ui.html');
  const cssPath = path.join(rootDir, 'src', 'ui', 'styles.css');
  const template = await fs.readFile(templatePath, 'utf8');
  const css = await fs.readFile(cssPath, 'utf8');

  const uiBuild = await build({
    entryPoints: [path.join(rootDir, 'src', 'ui', 'ui.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    sourcemap: false,
  });

  const script = uiBuild.outputFiles[0]?.text ?? '';
  const html = template
    .replace('<!-- UI_STYLE -->', `<style>${css}</style>`)
    .replace('<!-- UI_SCRIPT -->', `<script>${script}</script>`);

  await fs.writeFile(path.join(buildDir, 'ui.html'), html, 'utf8');

  const embedContent = `export default ${escapeForJsonString(html)};\n`;
  await fs.writeFile(path.join(generatedDir, 'ui-embed.ts'), embedContent, 'utf8');
}

async function buildMain() {
  await build({
    entryPoints: [path.join(rootDir, 'src', 'main.ts')],
    bundle: true,
    outfile: path.join(buildDir, 'main.js'),
    platform: 'neutral',
    format: 'esm',
    target: ['es2022'],
    minify: false,
    sourcemap: true,
    loader: {
      '.svg': 'text',
      '.html': 'text',
    },
  });
}

async function runBuild() {
  await ensureDirs();
  await writeUiEmbed();
  await buildMain();
}

async function rebuildAll() {
  await writeUiEmbed();
  await buildMain();
}

async function runWatch() {
  await ensureDirs();
  await rebuildAll();

  const mainWatcher = await context({
    entryPoints: [path.join(rootDir, 'src', 'main.ts')],
    bundle: true,
    outfile: path.join(buildDir, 'main.js'),
    platform: 'neutral',
    format: 'esm',
    target: ['es2022'],
    minify: false,
    sourcemap: true,
    loader: {
      '.svg': 'text',
      '.html': 'text',
    },
  });

  await mainWatcher.watch();

  const uiDir = path.join(rootDir, 'src', 'ui');
  nodeFs.watch(uiDir, { recursive: true }, () => {
    rebuildAll().catch((error) => {
      console.error('UI re-build failed:', error);
    });
  });

  console.log('Watching for changes. Press Ctrl+C to stop.');
}

const shouldWatch = process.argv.includes('--watch');

if (shouldWatch) {
  runWatch().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  runBuild().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

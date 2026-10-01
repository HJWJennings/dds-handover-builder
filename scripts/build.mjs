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

/**
 * Escapes any literal "</tagName" inside `source` as "<\/tagName" so it can't be
 * misread as a closing tag by the HTML parser once embedded inside <style>/<script>.
 */
function escapeClosingTag(source, tagName) {
  const pattern = new RegExp(`</(${tagName})`, 'gi');
  return source.replace(pattern, (_match, name) => `<\\/${name}`);
}

/** Fails the build if `script` isn't syntactically valid JS (catches corrupted string-replace inlining). */
function assertValidScript(script, label) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(script);
  } catch (error) {
    throw new Error(`Inlined script "${label}" is not valid JavaScript: ${error.message}`);
  }
}

/** Extracts the raw contents of every <script>...</script> block in `html`. */
function extractInlineScripts(html) {
  const scripts = [];
  const pattern = /<script>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    scripts.push(match[1]);
  }
  return scripts;
}

function assertNoRejectedImportExpressions(source, label) {
  const pattern = /import\s*\(/gi;
  let match;
  let found = false;

  while ((match = pattern.exec(source)) !== null) {
    found = true;
    const lineStart = source.lastIndexOf('\n', match.index - 1) + 1;
    const nextNewline = source.indexOf('\n', match.index);
    const lineEnd = nextNewline === -1 ? source.length : nextNewline;
    const lineNumber = source.slice(0, lineStart).split('\n').length;
    const contextStart = Math.max(lineStart, match.index - 40);
    const contextEnd = Math.min(lineEnd, match.index + match[0].length + 40);
    const context = source.slice(contextStart, contextEnd);
    console.error(`[build] Forbidden dynamic-import syntax in ${label}:${lineNumber}: ${context}`);
  }

  if (found) {
    throw new Error(`Figma sandbox rejects dynamic-import syntax in ${label}.`);
  }
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

  const rawScript = uiBuild.outputFiles[0]?.text ?? '';

  // Validate the bundle itself before any string surgery, so failures point at esbuild's output.
  assertValidScript(rawScript, 'ui.ts bundle (pre-inline)');

  const safeCss = escapeClosingTag(css, 'style');
  const safeScript = escapeClosingTag(rawScript, 'script');

  // Function replacers, never string replacers: a string replacement re-interprets
  // $&, $`, $', $1 etc. found inside minified CSS/JS, silently corrupting the output.
  const html = template
    .replace('<!-- UI_STYLE -->', () => `<style>${safeCss}</style>`)
    .replace('<!-- UI_SCRIPT -->', () => `<script>${safeScript}</script>`);

  await fs.writeFile(path.join(buildDir, 'ui.html'), html, 'utf8');

  // Re-extract from the actual written HTML and validate again: this is the real guard,
  // since it catches corruption introduced by the inlining/escaping step itself.
  const inlineScripts = extractInlineScripts(html);
  if (inlineScripts.length === 0) {
    throw new Error('build/ui.html has no <script> block after inlining; UI_SCRIPT marker probably failed to match.');
  }
  inlineScripts.forEach((script, index) => assertValidScript(script, `build/ui.html <script> #${index + 1}`));
  console.log(`[build] ui.html inline script check passed (${inlineScripts.length} block(s), ${safeScript.length} chars).`);

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

  const mainBundle = await fs.readFile(path.join(buildDir, 'main.js'), 'utf8');
  assertNoRejectedImportExpressions(mainBundle, 'build/main.js');

  const builtUi = await fs.readFile(path.join(buildDir, 'ui.html'), 'utf8');
  const inlineScripts = extractInlineScripts(builtUi);
  inlineScripts.forEach((script, index) => {
    assertNoRejectedImportExpressions(script, `build/ui.html <script> #${index + 1}`);
  });
  console.log(`[build] sandbox import-expression check passed (main.js + ${inlineScripts.length} inline UI script(s)).`);
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

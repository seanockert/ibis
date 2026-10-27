import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { defineConfig } from 'vite';

// Removes comments, indents and empty lines from GLSL. Keeps each line, so preprocessor lines stay
// on their own lines. Keeps comment lines that name a licence.
function minifyGlsl(src) {
  return src
    .split('\n')
    .map(line => (/\bMIT\b|licen[cs]e/i.test(line) ? line : line.replace(/\/\/.*/, '')))
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

// Loads `*.glsl?raw` imports minified in the build. The dev server keeps the full source, so
// shader errors show the true line numbers.
function glslRawMinify() {
  return {
    name: 'glsl-raw-minify',
    apply: 'build',
    enforce: 'pre',
    async load(id) {
      const [file, query] = id.split('?');
      if (!file.endsWith('.glsl') || query !== 'raw') return null;
      return `export default ${JSON.stringify(minifyGlsl(await readFile(file, 'utf8')))};`;
    },
  };
}

// Writes dist/sw.js: src/sw.js with the list of every file in dist and a hash of the worker and the files. The
// hash changes when any file changes, so the browser installs the new worker after a deploy.
function swPlugin() {
  let outDir;
  return {
    name: 'service-worker',
    apply: 'build',
    configResolved(config) { outDir = config.build.outDir; },
    async closeBundle() {
      const files = (await readdir(outDir, { recursive: true, withFileTypes: true }))
        .filter(f => f.isFile() && f.name !== 'sw.js' && !f.name.startsWith('.'))
        .map(f => '/' + relative(outDir, join(f.parentPath, f.name)).split(sep).join('/'))
        .sort();
      const worker = await readFile('src/sw.js', 'utf8'), hash = createHash('sha256').update(worker);
      for (const f of files) hash.update(f).update(await readFile(join(outDir, f)));
      const head = `const VERSION = '${hash.digest('hex').slice(0, 12)}';\nconst FILES = ${JSON.stringify(['/', ...files])};\n\n`;
      await writeFile(join(outDir, 'sw.js'), head + worker);
    },
  };
}

export default defineConfig({
  plugins: [glslRawMinify(), swPlugin()],
  build: {
    rolldownOptions: {
      output: {
        // three.js in its own chunk: a change to the ibis code does not invalidate it in the cache.
        codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] },
      },
    },
  },
});

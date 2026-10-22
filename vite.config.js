import { readFile } from 'node:fs/promises';
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

export default defineConfig({
  plugins: [glslRawMinify()],
  build: {
    rolldownOptions: {
      output: {
        // three.js in its own chunk: a change to the ibis code does not invalidate it in the cache.
        codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] },
      },
    },
  },
});

import { transform } from 'esbuild';
import { defineConfig, type Plugin } from 'vitest/config';

const TYPESCRIPT_FILE = /\.ts$/;
const TYPESCRIPT_LOADER = 'ts';
const TARGET = 'es2023';
const SOURCE_CONDITION = 'source';

const standardDecorators: Plugin = {
  name: 'standard-decorators',
  enforce: 'pre',
  async transform(code, id) {
    if (!TYPESCRIPT_FILE.test(id)) return null;
    const result = await transform(code, {
      loader: TYPESCRIPT_LOADER,
      target: TARGET,
      sourcefile: id,
      sourcemap: true,
    });
    return { code: result.code, map: result.map };
  },
};

export const sharedConfig = defineConfig({
  oxc: false,
  plugins: [standardDecorators],
  resolve: {
    conditions: [SOURCE_CONDITION],
  },
  ssr: {
    resolve: {
      conditions: [SOURCE_CONDITION],
    },
  },
});

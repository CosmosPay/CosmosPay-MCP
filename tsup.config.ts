import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// One ESM bundle for the `cosmos-pay-mcp` bin. esbuild resolves the `@/` alias from tsconfig.json,
// so the published file has no alias left in it. The shebang comes from src/index.ts.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  // src/api.ts reads it for the User-Agent and --version.
  define: { __VERSION__: JSON.stringify(version) },
});

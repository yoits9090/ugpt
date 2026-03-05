import { build } from "esbuild";

await build({
  entryPoints: ["index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/server.mjs",
  minify: true,
  sourcemap: false,
  banner: {
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
});

console.log("Built dist/server.mjs");

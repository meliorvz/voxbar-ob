import esbuild from "esbuild";
import process from "node:process";
import builtins from "builtin-modules";

const prod = process.argv.includes("production");

const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  format: "cjs",
  target: "es2020",
  platform: "node",
  outfile: "main.js",
  sourcemap: prod ? false : "inline",
  external: ["obsidian", "electron", ...builtins],
  logLevel: "info",
});

if (prod) {
  await context.rebuild();
  await context.dispose();
  process.exit(0);
}

await context.watch();


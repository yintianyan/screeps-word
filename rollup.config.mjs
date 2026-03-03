import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from '@rollup/plugin-terser';

export default {
  input: "src/main.ts",
  output: {
    file: "main.js",
    format: "cjs",
    sourcemap: true,
  },
  plugins: [
    resolve({ rootDir: "src" }),
    commonjs(),
    typescript({ tsconfig: "./tsconfig.build.json" }),
    terser()
  ],
  external: ["lodash"], // lodash usually exists in global, but sometimes we bundle it. Screeps has global _.
};

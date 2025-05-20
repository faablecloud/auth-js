import json from "@rollup/plugin-json";
import babel from "@rollup/plugin-babel";
import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";
import generatePackageJson from "rollup-plugin-generate-package-json";
import replace from "@rollup/plugin-replace";
import resolve from "@rollup/plugin-node-resolve";
import filesize from "rollup-plugin-filesize";
import alias from "@rollup/plugin-alias";
import terser from "@rollup/plugin-terser";
import fs from "fs-extra";
import copy from "rollup-plugin-copy";

const pkg = fs.readJSONSync("./package.json");

// Work out if we're targetting development
const isProduction = process.env.NODE_ENV == "production";

function getAuthors(pkg) {
  const { contributors, author } = pkg;

  const authors = new Set();
  if (contributors && contributors)
    contributors.forEach((contributor) => {
      authors.add(contributor.name);
    });
  if (author) authors.add(author.name);

  return Array.from(authors).join(", ");
}

const banner = `/*!
 * ${pkg.name} v${pkg.version}
 * (c) ${new Date().getFullYear()} ${getAuthors(pkg)}
 * @license ${pkg.license}
 */`;

const plugins = (es5) => [
  json(),
  resolve({
    browser: true,
    preferBuiltins: false,
    mainFields: ["module", "main", "jsnext:main", "browser"],
    extensions: [".js", ".jsx", ".ts", ".tsx"],
  }),
  typescript({ sourceMap: true }),
  commonjs(),
  babel({
    extensions: [".js", ".jsx", ".ts", ".tsx"],
    babelHelpers: "bundled",
    plugins: [
      "@babel/plugin-transform-nullish-coalescing-operator",
      // Explicitly included so we transform 1 ** 2 to Math.pow(1, 2) for ES6 compatability
      "@babel/plugin-transform-exponentiation-operator",
    ],
    presets: [
      [
        "@babel/preset-env",
        {
          targets: es5
            ? [
                "> 0.5%, last 2 versions, Firefox ESR, not dead",
                "chrome > 62",
                "firefox > 59",
                "ios_saf >= 6.1",
                "opera > 50",
                "safari > 12",
                "IE 11",
              ]
            : [
                "> 0.5%, last 2 versions, Firefox ESR, not dead",
                "chrome > 62",
                "firefox > 59",
                "ios_saf >= 10.3",
                "opera > 50",
                "safari > 12",
              ],
        },
      ],
    ],
  }),
  alias({
    entries: [
      { find: "react", replacement: "preact/compat" },
      { find: "react-dom/test-utils", replacement: "preact/test-utils" },
      { find: "react-dom", replacement: "preact/compat" },
      { find: "react/jsx-runtime", replacement: "preact/jsx-runtime" },
    ],
  }),
  replace({
    preventAssignment: true,
    "process.env.NODE_ENV": isProduction
      ? JSON.stringify("production")
      : JSON.stringify("development"),
    "process.env.CONTEXT_ID": JSON.stringify(pkg.name),
    "process.env.VERSION": JSON.stringify(pkg.version),
    __buildDate__: () => JSON.stringify(new Date()),
  }),
  generatePackageJson({
    outputFolder: "pkg",
    baseContents: (pkg) => ({
      name: pkg.name,
      main: pkg.main,
      //dependencies: pkg.dependencies,
      version: pkg.version,
      type: "module",
      license: pkg.license,
      author: pkg.author,
      publishConfig: {
        access: "public",
      },
    }),
  }),
  isProduction &&
    terser({
      toplevel: true,
      compress: {
        // 5 is the default if unspecified
        ecma: es5 ? 5 : 6,
      },
    }),
  isProduction &&
    copy({
      targets: [{ src: "README.md", dest: "pkg" }],
    }),
  filesize(),
];

const entrypoints = fs.readdirSync("./src/entrypoints");
const entrypointTargets = entrypoints.map((file) => {
  const fileParts = file.split(".");
  // pop the extension
  fileParts.pop();

  let format = fileParts[fileParts.length - 1];
  // NOTE: Sadly we can't just use the file extensions as tsc won't compile things correctly
  if (["cjs", "es", "iife"].includes(format)) {
    fileParts.pop();
  } else {
    format = "iife";
  }

  const fileName = fileParts.join(".");

  const pluginsForThisFile = plugins(fileName.includes("es5"));

  // we're allowed to console log in this file :)
  // eslint-disable-next-line no-console
  console.log(`Building ${fileName} in ${format} format`);

  return {
    input: `src/entrypoints/${file}`,
    output: [
      {
        file: `pkg/dist/${fileName}.js`,
        sourcemap: true,
        banner,
        ...(format === "iife"
          ? {
              name: "faableauth",
              format: "iife",
              // globals: {
              //   preact: "preact",
              // },
            }
          : {}),
        ...(format === "cjs" ? { exports: "auto" } : {}),
      },
    ],
    plugins: pluginsForThisFile,
  };
});

export default [...entrypointTargets];

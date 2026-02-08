const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const js = require("@eslint/js");

module.exports = [
    js.configs.recommended,
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module"
            },
            globals: {
                // Screeps globals
                Game: "readonly",
                Memory: "readonly",
                Room: "readonly",
                Creep: "readonly",
                Structure: "readonly",
                Source: "readonly",
                // ... add others or use "node": true if appropriate, but Screeps is weird
                // actually, since we have @types/screeps, we might not need to define them here if no-undef is off
                // But let's define 'console' and standard things
                console: "readonly",
                module: "readonly",
                require: "readonly",
                exports: "readonly"
            }
        },
        plugins: {
            "@typescript-eslint": tsPlugin
        },
        rules: {
            ...tsPlugin.configs.recommended.rules,
            "@typescript-eslint/ban-ts-comment": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "no-undef": "off",
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }]
        }
    }
];

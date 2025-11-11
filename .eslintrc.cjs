module.exports = {
    root: true,
    env: {
        es2021: true,
        node: true,
    },
    parser: '@typescript-eslint/parser',
    plugins: ['@typescript-eslint'],
    extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
    ignorePatterns: ['dist/', 'node_modules/'],
    overrides: [
        {
            files: ['packages/analyzer/**/*.{ts,tsx}'],
            parserOptions: {
                project: ['./packages/analyzer/tsconfig.json'],
                tsconfigRootDir: __dirname,
            },
        },
    ],
};
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    // .mjs 工具脚本不进 lint：它们不在任何 tsconfig 里，typescript-eslint 的
    // 类型规则会在加载时就抛错。这些脚本由实际执行（pnpm contracts /
    // node tools/demo.mjs）来验证。
    //
    // 构建/测试配置与 e2e 目录同理：不进任何包的 tsconfig，而 projectService
    // 的 glob 按绝对路径匹配，写法相当别扭。它们由 tsconfig.eslint.json 做
    // 类型检查，这里直接排除。
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
      '**/*.mjs',
      '**/*config.ts',
      '**/e2e/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // 各包 tsconfig.json 现在包含测试文件（typecheck 要看它们），
          // 但 vite/vitest/playwright 配置与 e2e 目录不在其中——
          // 这些文件交给 defaultProject 指明的全量工程。
          defaultProject: './tsconfig.eslint.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-param-reassign': 'error',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'multi-line'],
    },
  },
  {
    files: ['packages/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // 拉数据的 hook 必须在 effect 里同步置上"加载中"，否则界面会停留在
      // 上一页的数据上让人误判。这是 fetch-on-mount 的固有形态，用 ref 或
      // useTransition 绕开只会把复杂度转嫁给读者。
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // 测试文件刻意与松散类型打交道：夹具、mock、JSON 解析结果都是 unknown，
    // 逐处窄化只会让测试变得比被测代码还难读。这些文件由 tsc（strict）
    // 与 vitest 把关，unsafe 系列规则在这里关掉。
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      'no-console': 'off',
    },
  },
)

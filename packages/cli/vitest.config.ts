import { defineConfig } from 'vitest/config'

/**
 * CLI 包的测试配置。
 *
 * 覆盖率阈值按仓库规范设 80%（行 / 函数 / 分支 / 语句）。排除三类文件：
 *   - `src/bin.ts`：20 行的进程入口（process.exit 不可单测）；
 *   - `src/test-support/**`：测试替身本身，覆盖它没有意义；
 *   - `*.test.ts`：测试文件不是被测代码。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/bin.ts',
        // 纯类型再导出，没有任何运行时代码可覆盖
        'src/api-types.ts',
        'src/test-support/**',
        'src/**/*.test.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
})

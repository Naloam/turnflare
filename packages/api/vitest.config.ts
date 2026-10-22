import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      // types.ts 是纯类型声明，没有任何可执行语句，留着会把总平均值拉到 86%
      // 而掩盖真实数字。core 包的 vitest.config.ts 同样排除了它。
      //
      // src/server.ts **不**排除：它曾是这里唯一的"整文件静默排除"项，而它有
      // 150+ 行真实可执行代码（buildApp / start / shutdown / 启动失败路径）。
      // 实测纳进来的成本很低：server.test.ts 的 `start()` describe 只加了两条
      // （真端口 + `:memory:` 库启动一次、端口被占用时再启动一次），就把这个文件
      // 从 52.9% 抬到 75.5% 语句 / 72.7% 分支，整包只从 98.2% 掉到 97.2%，
      // 仍远高于下面的 80% 阈值。
      //
      // 仍然覆盖不到的是文件末尾那段"被直接执行才启动"的入口守卫
      // （isDirectRun / toStartupMessage）：它只在 `node dist/server.js` 时成立，
      // 单测里要么子进程重 exec、要么靠 import.meta.url 作假，两者都比被守卫的
      // 代码本身更难维护。真要补齐请先想清楚值不值得。
      exclude: ['src/**/*.test.ts', 'src/types.ts', 'src/test-support/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
})

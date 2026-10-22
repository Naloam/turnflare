/**
 * stats 模块入口：用量运算、去重、时间分桶、聚合统计。
 *
 * 注意：不导出 ./narrow.js —— 那些 unknown 窄化助手是本模块的内部实现细节，
 * 暴露出去只会扩大公开 API 表面并诱导其他包绕过冻结契约直接读脏数据。
 */

export * from './types.js'
export * from './usage.js'
export * from './dedupe.js'
export * from './bucket.js'
export * from './tools.js'
export * from './aggregate.js'

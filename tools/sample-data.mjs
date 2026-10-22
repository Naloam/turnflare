/** Public, deterministic fixtures shared by the demo, smoke test and browser tests. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const MODELS = ['claude-opus-4-6', 'claude-sonnet-4-6', 'example-unpriced-model']
const PROJECTS = ['website', 'api', 'research']

function record(sessionId, uuid, minute, fields) {
  return {
    sessionId,
    uuid,
    parentUuid: null,
    timestamp: new Date(
      Date.UTC(2026, 9, 12 + Math.floor(minute / 60), 8, minute % 60),
    ).toISOString(),
    cwd: '/demo/turnflare',
    gitBranch: 'main',
    ...fields,
  }
}

/** Creates a fresh temporary tree. Never reads the user's home directory or environment. */
export function createSampleRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'turnflare-sample-'))
  for (let index = 0; index < 9; index += 1) {
    const project = path.join(root, `-demo-${PROJECTS[index % PROJECTS.length]}`)
    mkdirSync(project, { recursive: true })
    const sessionId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
    const rows = []
    for (let turn = 0; turn < 4; turn += 1) {
      const id = `${sessionId}-${turn}`
      rows.push(
        record(sessionId, `${id}-user`, index * 60 + turn * 2, {
          type: 'user',
          message: { role: 'user', content: 'Review the example project.' },
        }),
      )
      rows.push(
        record(sessionId, `${id}-assistant`, index * 60 + turn * 2 + 1, {
          type: 'assistant',
          parentUuid: `${id}-user`,
          isSidechain: turn === 3,
          message: {
            role: 'assistant',
            model: MODELS[index % MODELS.length],
            content: [
              {
                type: 'text',
                text: turn === 3 ? 'Subagent review complete.' : 'Example analysis complete.',
              },
              {
                type: 'tool_use',
                id: `tool-${id}`,
                name: 'Read',
                input: { file_path: '/demo/example.ts' },
              },
            ],
            usage: {
              input_tokens: 1200 * (index + 1),
              output_tokens: 180 * (turn + 1),
              cache_creation_input_tokens: 400,
              cache_read_input_tokens: 6000,
              cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 0 },
            },
          },
        }),
      )
    }
    writeFileSync(
      path.join(project, `${sessionId}.jsonl`),
      rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
    )
  }
  const telemetry = path.join(root, '-demo-website', 'plugin')
  mkdirSync(telemetry)
  writeFileSync(path.join(telemetry, 'telemetry.jsonl'), '{"event":"example-telemetry"}\n')
  return root
}

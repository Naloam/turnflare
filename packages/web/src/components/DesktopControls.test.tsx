import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopControls } from './DesktopControls'

afterEach(() => {
  Object.defineProperty(window, 'turnflareDesktop', { value: undefined, configurable: true })
})
it('stays absent in the browser', () => {
  const { container } = render(<DesktopControls />)
  expect(container).toBeEmptyDOMElement()
})
it('offers native folder selection and a way back from the isolated demo', async () => {
  const chooseFolder = vi.fn().mockResolvedValue(undefined)
  const showLocal = vi.fn().mockRejectedValue(new Error('unavailable'))
  Object.defineProperty(window, 'turnflareDesktop', {
    configurable: true,
    value: {
      getState: async () => ({
        mode: 'demo',
        dataRoot: '/sample',
        sessionCount: 9,
        failedFiles: 0,
        version: '0.2.0',
      }),
      chooseFolder,
      showLocal,
      showDemo: vi.fn(),
    },
  })
  render(<DesktopControls />)
  await screen.findByText('示例模式')
  fireEvent.click(screen.getByRole('button', { name: '选择日志目录' }))
  await waitFor(() => expect(chooseFolder).toHaveBeenCalledOnce())
  await waitFor(() => expect(screen.getByRole('button', { name: '选择日志目录' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '返回本地记录' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('无法打开数据')
})

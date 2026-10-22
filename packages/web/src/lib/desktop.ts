import type { DesktopBridge } from '@turnflare/contracts'

declare global {
  interface Window {
    readonly turnflareDesktop?: DesktopBridge
  }
}

export function desktopBridge(): DesktopBridge | undefined {
  return window.turnflareDesktop
}

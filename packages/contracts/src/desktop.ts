/** The renderer receives only these capabilities, never raw Electron or filesystem access. */
export interface DesktopState {
  readonly mode: 'local' | 'demo'
  readonly dataRoot: string
  readonly sessionCount: number
  readonly failedFiles: number
  readonly version: string
}

export interface DesktopBridge {
  getState(): Promise<DesktopState>
  chooseFolder(): Promise<void>
  showDemo(): Promise<void>
  showLocal(): Promise<void>
}

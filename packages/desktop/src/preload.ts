import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge, DesktopState } from '@turnflare/contracts'

const bridge: DesktopBridge = {
  getState: (): Promise<DesktopState> => ipcRenderer.invoke('desktop:state'),
  chooseFolder: (): Promise<void> => ipcRenderer.invoke('desktop:choose-folder'),
  showDemo: (): Promise<void> => ipcRenderer.invoke('desktop:demo'),
  showLocal: (): Promise<void> => ipcRenderer.invoke('desktop:local'),
}
contextBridge.exposeInMainWorld('turnflareDesktop', Object.freeze(bridge))

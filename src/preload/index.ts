import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type DashboardApi, type ProjectUpdate } from '../shared/ipc.js';

/**
 * The only thing the interface can reach. Each method forwards to one fixed channel;
 * ipcRenderer itself is never exposed.
 */
const api: DashboardApi = {
  getSnapshot: () => ipcRenderer.invoke(CHANNELS.getSnapshot),
  startScan: () => ipcRenderer.invoke(CHANNELS.startScan),
  onProjectUpdate(listener) {
    const wrapped = (_e: unknown, update: ProjectUpdate) => listener(update);
    ipcRenderer.on(CHANNELS.update, wrapped);
    return () => { ipcRenderer.removeListener(CHANNELS.update, wrapped); };
  },
  setNextAction: (name, text) => ipcRenderer.invoke(CHANNELS.setNextAction, name, text),
  setCriterion: (name, blockId, checked) => ipcRenderer.invoke(CHANNELS.setCriterion, name, blockId, checked),
  promote: (name, swap) => ipcRenderer.invoke(CHANNELS.promote, name, swap),
  park: (name, reason, revisitOn) => ipcRenderer.invoke(CHANNELS.park, name, reason, revisitOn),
  kill: (name) => ipcRenderer.invoke(CHANNELS.kill, name),
  unpark: (name) => ipcRenderer.invoke(CHANNELS.unpark, name),
  markShipped: (name) => ipcRenderer.invoke(CHANNELS.markShipped, name),
  addToNotion: (name) => ipcRenderer.invoke(CHANNELS.addToNotion, name),
  ignoreFolder: (name, ignored) => ipcRenderer.invoke(CHANNELS.ignoreFolder, name, ignored),
  linkFolder: (name, pageId) => ipcRenderer.invoke(CHANNELS.linkFolder, name, pageId),
  applyReview: (plan) => ipcRenderer.invoke(CHANNELS.applyReview, plan),
  getSettings: () => ipcRenderer.invoke(CHANNELS.getSettings),
  saveSettings: (patch) => ipcRenderer.invoke(CHANNELS.saveSettings, patch),
  setToken: (token) => ipcRenderer.invoke(CHANNELS.setToken, token),
  openLink: (name, kind) => ipcRenderer.invoke(CHANNELS.openLink, name, kind),
};

contextBridge.exposeInMainWorld('dashboard', api);

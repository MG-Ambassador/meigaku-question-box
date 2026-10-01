/** Keep native Back/Forward entries intact when an unsaved edit blocks navigation. */
export const ADMIN_HISTORY_CHANGE = 'admin-history-change';
const key = 'questionBoxHistoryIndex';
export function historyIndex(): number {
  return typeof window.history.state?.[key] === 'number' ? window.history.state[key] : 0;
}
export function initializeAdminHistory() {
  window.history.replaceState({ ...window.history.state, [key]: historyIndex() }, '');
}
export function writeAdminHistory(url: string, replace = false) {
  const index = historyIndex() + (replace ? 0 : 1);
  window.history[replace ? 'replaceState' : 'pushState']({ ...window.history.state, [key]: index }, '', url);
  window.dispatchEvent(new Event(ADMIN_HISTORY_CHANGE));
}

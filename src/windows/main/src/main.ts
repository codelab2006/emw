import './style.css';

const electronAPI = window.electronAPI;
const runtimeValues = new Map<string, string>([
  ['#platform', electronAPI?.platform ?? 'Unavailable'],
  ['#chrome-version', electronAPI?.versions.chrome ?? 'Unavailable'],
  ['#electron-version', electronAPI?.versions.electron ?? 'Unavailable'],
  ['#node-version', electronAPI?.versions.node ?? 'Unavailable'],
]);

for (const [selector, value] of runtimeValues) {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

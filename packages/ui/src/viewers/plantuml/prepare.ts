// Source preparation before encoding: a transparent background so the picture
// sits on leaf's block, and a dark PlantUML theme when the page is dark (the
// Stage asks for light; its canvas is white). Themes ship inside plantuml.jar.
const DARK_THEME = 'cyborg-outline';

export function preparePlantUml(source: string, dark: boolean): string {
  const head = ['skinparam backgroundColor transparent'];
  if (dark) head.unshift(`!theme ${DARK_THEME}`);
  const lines = source.trim().split('\n');
  const start = lines.findIndex((l) => /^\s*@start\w+/.test(l));
  if (start === -1) return ['@startuml', ...head, ...lines, '@enduml'].join('\n');
  return [...lines.slice(0, start + 1), ...head, ...lines.slice(start + 1)].join('\n');
}

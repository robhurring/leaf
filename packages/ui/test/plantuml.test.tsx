import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { FileMessage } from '@leaf/protocol';
import { decodePlantUml, encodePlantUml } from '../src/viewers/plantuml/encode.js';
import { preparePlantUml } from '../src/viewers/plantuml/prepare.js';
import { plantuml } from '../src/viewers/plantuml/index.js';
import { viewers } from '../src/viewers/index.js';

const src = '@startuml\nBob -> Alice : hello\n@enduml';
const file = (content: string): FileMessage => ({
  type: 'file',
  path: 'seq.puml',
  kind: 'text',
  lang: 'plantuml',
  mime: 'text/plain',
  encoding: 'utf8',
  content,
  url: '/raw/seq.puml',
  size: content.length,
  mtime: 1,
});

describe('plantuml encoding', () => {
  it('round-trips through the PlantUML text alphabet', () => {
    const enc = encodePlantUml(src);
    expect(enc).toMatch(/^[0-9A-Za-z_-]+$/);
    expect(decodePlantUml(enc)).toBe(src);
  });
  it('matches the documented example encoding', () => {
    // https://plantuml.com/text-encoding: "Bob -> Alice : hello"
    expect(encodePlantUml('Bob -> Alice : hello')).toBe('SyfFKj2rKt3CoKnELR1Io4ZDoSa70000');
  });
});

describe('plantuml viewer', () => {
  it('is picked for .puml files and plantuml fences', () => {
    expect(viewers.forFile(file(src)).id).toBe('plantuml');
    expect(viewers.forLang('plantuml')?.id).toBe('plantuml');
  });
  it('renders an image from the configured server', async () => {
    const { container } = render(
      <plantuml.Rich
        file={file(src)}
        content={src}
        docPath="seq.puml"
        config={{ plantumlUrl: 'https://puml.example/plantuml' }}
      />,
    );
    // The encoder loads on demand.
    await waitFor(() => expect(container.querySelector('img.leaf-plantuml')).toBeTruthy());
    const img = container.querySelector('img.leaf-plantuml')!;
    expect(img.getAttribute('src')).toBe(
      `https://puml.example/plantuml/svg/${encodePlantUml(preparePlantUml(src, false))}`,
    );
    // Loaded with CORS, so the picture can be copied as an image (the server allows it).
    expect(img.getAttribute('crossorigin')).toBe('anonymous');
  });
  it('shows the source with a hint when no server is configured', () => {
    render(<plantuml.Rich file={file(src)} content={src} docPath="seq.puml" config={{}} />);
    expect(screen.getByText(/PLANTUML_URL/)).toBeTruthy();
    expect(screen.getByText(/Bob -> Alice/)).toBeTruthy();
  });
});

describe('preparePlantUml', () => {
  it('always asks for a transparent background, inside the @startuml block', async () => {
    const { preparePlantUml } = await import('../src/viewers/plantuml/prepare.js');
    expect(preparePlantUml('@startuml\nBob -> Alice\n@enduml', false)).toBe(
      '@startuml\nskinparam backgroundColor transparent\nBob -> Alice\n@enduml',
    );
  });
  it('wraps a bare body so the skinparam applies', async () => {
    const { preparePlantUml } = await import('../src/viewers/plantuml/prepare.js');
    expect(preparePlantUml('Bob -> Alice', false)).toBe(
      '@startuml\nskinparam backgroundColor transparent\nBob -> Alice\n@enduml',
    );
  });
  it('adds a dark theme when rendering for a dark appearance', async () => {
    const { preparePlantUml } = await import('../src/viewers/plantuml/prepare.js');
    expect(preparePlantUml('@startuml\nA -> B\n@enduml', true)).toBe(
      '@startuml\n!theme cyborg-outline\nskinparam backgroundColor transparent\nA -> B\n@enduml',
    );
  });
  it('the viewer encodes the prepared source and follows the appearance prop', async () => {
    const { preparePlantUml } = await import('../src/viewers/plantuml/prepare.js');
    const { plantuml } = await import('../src/viewers/plantuml/index.js');
    const { encodePlantUml } = await import('../src/viewers/plantuml/encode.js');
    const { render, waitFor } = await import('@testing-library/react');
    const src = '@startuml\nBob -> Alice : hello\n@enduml';
    const file = {
      type: 'file' as const,
      path: 'seq.puml',
      kind: 'text' as const,
      mime: 'text/plain',
      encoding: 'utf8' as const,
      url: '/raw/seq.puml',
      size: 1,
      mtime: 1,
    };
    const { container } = render(
      <plantuml.Rich
        file={file}
        content={src}
        docPath="seq.puml"
        config={{ plantumlUrl: 'https://puml.example/plantuml' }}
        appearance="dark"
      />,
    );
    await waitFor(() => expect(container.querySelector('img.leaf-plantuml')).toBeTruthy());
    expect(container.querySelector('img.leaf-plantuml')!.getAttribute('src')).toBe(
      `https://puml.example/plantuml/svg/${encodePlantUml(preparePlantUml(src, true))}`,
    );
  });
});

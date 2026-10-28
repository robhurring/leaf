// The plain highlighted fenced block (label + copy). The app injects a framed
// version through RenderOptions.components; render/ knows nothing about viewers.
import { useState, type ReactNode } from 'react';

export type CodeBlockProps = {
  'data-lang'?: string;
  'data-meta'?: string;
  'data-code'?: string;
  'data-pos'?: string;
  'data-doc'?: string;
  children?: ReactNode;
};

export function CodeBlock(props: CodeBlockProps) {
  const lang = props['data-lang'] ?? 'text';
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props['data-code'] ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="leaf-block leaf-codeblock" data-lang={lang} data-pos={props['data-pos']}>
      <span className="leaf-block-lang">{lang}</span>
      <div className="leaf-block-tools" role="group" aria-label="Block tools">
        <button
          type="button"
          className="leaf-tool"
          title={copied ? 'Copied' : 'Copy'}
          onClick={copy}
          aria-label="Copy code"
        >
          {copied ? '✓' : '⧉'}
        </button>
      </div>
      {props.children}
    </div>
  );
}

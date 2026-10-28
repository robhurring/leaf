// Keeps one broken document or viewer from unmounting the whole reader.
import { Component, type ReactNode } from 'react';

type Props = { label: string; resetKey?: unknown; children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error) return <RenderError label={this.props.label} error={this.state.error} />;
    return this.props.children;
  }
}

export function RenderError({ label, error }: { label: string; error: Error }) {
  return (
    <div className="leaf-doc-state leaf-error" role="alert">
      <p className="leaf-doc-state-title">Something went wrong rendering this {label}</p>
      <pre className="leaf-doc-state-detail">{error.message}</pre>
    </div>
  );
}

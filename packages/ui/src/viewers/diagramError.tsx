// Shared in-place error for diagram viewers: the message, never a blank block.
export function DiagramError({ kind, message }: { kind: string; message: string }) {
  return (
    <div className="leaf-diagram-error" role="alert">
      <span className="leaf-diagram-error-kind">{kind}</span> {message}
    </div>
  );
}

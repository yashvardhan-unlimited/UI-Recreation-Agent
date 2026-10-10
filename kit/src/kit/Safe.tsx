import { Component, type ReactNode } from "react";

type Props = { id: string; children: ReactNode };

// The only class in the codebase: React has no hook for error boundaries.
class Boundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error(`[section ${this.props.id}] ${error.message}`);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Per-section error boundary: a crashing section renders nothing and logs "[section <id>] <message>". */
export function Safe({ id, children }: Props) {
  return <Boundary id={id}>{children}</Boundary>;
}

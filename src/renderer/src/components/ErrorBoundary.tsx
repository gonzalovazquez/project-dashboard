import { Component, type ReactNode } from 'react';

interface State { error?: Error }

/** Catches a screen that fails to draw, so one bad value cannot leave a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {};
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error) { console.error('The interface failed to draw', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert" data-state="crashed">
        <h1>Something went wrong</h1>
        <p>The screen could not be drawn. Your projects and Notion pages are untouched.</p>
        <pre className="mono">{this.state.error.message}</pre>
        <div className="pa">
          <button className="btn" onClick={() => this.setState({ error: undefined })} data-action="try-again">Try again</button>
          <button className="btn primary" onClick={() => window.location.reload()} data-action="reload">Reload</button>
        </div>
      </div>
    );
  }
}

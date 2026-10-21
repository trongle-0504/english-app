import { Component, type ReactNode } from 'react'

/** Swallows errors from optional page decorations (stats, teasers) so they can't take the page down. */
export class QuietBoundary extends Component<{ fallback?: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children
  }
}

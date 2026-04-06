// components/ErrorBoundary.tsx
import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return this.props.fallback || (
                <div style={{ padding: '20px', color: 'red' }}>
                    <h2>Something went wrong</h2>
                    <pre>{this.state.error?.message}</pre>
                    <details>
                        <summary>Stack trace</summary>
                        <pre>{this.state.error?.stack}</pre>
                    </details>
                </div>
            );
        }

        return this.props.children;
    }
}

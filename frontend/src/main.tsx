import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './theme/ThemeProvider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/*
 * One QueryClient for the app.
 *
 * `throwOnError: false` because every consumer of a query here renders its own
 * error state. An error boundary would replace the whole dashboard with a
 * message when one endpoint is unreachable, and this product's value is that
 * the parts which still work keep working.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { throwOnError: false, refetchOnReconnect: true } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)

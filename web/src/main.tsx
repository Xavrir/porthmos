import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import '@fontsource/albert-sans/400.css'
import '@fontsource/albert-sans/500.css'
import '@fontsource/albert-sans/600.css'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import './styles/base.css'
import './styles/app.css'
import './styles/landing.css'
import './styles/dashboard.css'
import './styles/auth.css'
import { wagmiConfig } from './lib/wallet'
import { ApiProvider } from './lib/source'
import { IdentityProvider } from './lib/identity'
import { App } from './App'
import { startReveal } from './lib/reveal'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5000, refetchOnWindowFocus: false, retry: 1 } },
})

startReveal()

// Not "root": some embedding browsers inject a #root background rule (rgb(20, 25, 36)) that beats our own styles.
createRoot(document.getElementById('porthmos')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ApiProvider>
          <IdentityProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </IdentityProvider>
        </ApiProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)

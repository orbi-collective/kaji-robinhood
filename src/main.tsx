import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { wagmiConfig } from './lib/chain'
import { AgentProvider } from './state/AgentStore'
import { ErrorBoundary, RouteFocus } from './components/AppShell'
import RiskGate from './components/RiskGate'
import Landing from './pages/Landing'
import Scanner from './pages/Scanner'
import Recipe from './pages/Recipe'
import Vault from './pages/Vault'
import Security from './pages/Security'
import Docs from './pages/Docs'
import Payout from './pages/Payout'
import NotFound from './pages/NotFound'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AgentProvider>
          <BrowserRouter>
            <ErrorBoundary>
              <RiskGate />
              <RouteFocus />
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/opportunities" element={<Scanner />} />
                <Route path="/recipes/:recipeId" element={<Recipe />} />
                <Route path="/recipes" element={<Navigate to="/opportunities" replace />} />
                {/* The limits are a panel inside the scanner now. Old links keep
                    working and open it on arrival. */}
                <Route path="/mandates/new" element={<Navigate to="/opportunities?limits=1" replace />} />
                <Route path="/mandates" element={<Navigate to="/opportunities?limits=1" replace />} />
                <Route path="/vaults/:address" element={<Vault />} />
                <Route path="/vaults" element={<Navigate to="/vaults/me" replace />} />
                <Route path="/security" element={<Security />} />
                <Route path="/payout" element={<Payout />} />
                <Route path="/docs" element={<Docs />} />
                {/* Both earlier names for the docs page. Old links, and anyone's
                    bookmark of them, should still land somewhere. */}
                <Route path="/mechanics" element={<Navigate to="/docs" replace />} />
                <Route path="/payroll" element={<Navigate to="/docs" replace />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </ErrorBoundary>
          </BrowserRouter>
        </AgentProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)

'use client'
import { RainbowKitProvider, getDefaultConfig, darkTheme } from '@rainbow-me/rainbowkit'
import { WagmiProvider } from 'wagmi'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import '@rainbow-me/rainbowkit/styles.css'

const bradbury = {
  id: 4221,
  name: 'GenLayer Bradbury Testnet',
  nativeCurrency: { decimals: 18, name: 'GEN', symbol: 'GEN' },
  rpcUrls: { default: { http: ['https://rpc-bradbury.genlayer.com'] } },
  blockExplorers: { default: { name: 'Bradbury Explorer', url: 'https://explorer-bradbury.genlayer.com' } },
  testnet: true,
} as const

const config = getDefaultConfig({
  appName: 'ProofScore — AI-Verified Reputation',
  projectId: 'a3c696a1d58dc441a304d5d5ce935634',
  chains: [bradbury],
  ssr: true,
})

const queryClient = new QueryClient()

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme({ accentColor: '#7C3AED', accentColorForeground: 'white', borderRadius: 'medium' })}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

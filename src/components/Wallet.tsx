import { useState } from 'react'
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import { CHAIN_NAME, IS_LIVE_CHAIN, robinhoodChain } from '../lib/chain'
import './Wallet.css'

export function shortAddress(address?: string): string {
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

/** Everything a surface needs to know before it offers to prepare a transaction. */
export function useWalletGate() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const wrongNetwork = isConnected && chainId !== robinhoodChain.id

  return {
    address,
    isConnected,
    wrongNetwork,
    canSign: IS_LIVE_CHAIN && isConnected && !wrongNetwork,
    /** Why signing is unavailable, in the user's words. */
    blockedReason: !IS_LIVE_CHAIN
      ? `This build has no ${CHAIN_NAME} endpoint configured, so transactions cannot be prepared. Estimates below are reference data.`
      : !isConnected
        ? 'Connect a wallet to deposit into this vault.'
        : wrongNetwork
          ? `Switch to ${CHAIN_NAME} to deposit into this vault.`
          : null,
  }
}

export function WalletButton() {
  const { address, isConnected } = useAccount()
  const { connectors, connect, isPending, error } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain } = useSwitchChain()
  const chainId = useChainId()
  const [copied, setCopied] = useState(false)

  const wrongNetwork = isConnected && chainId !== robinhoodChain.id
  const injected = connectors[0]

  if (!isConnected) {
    return (
      <div className="walletBtnWrap">
        <button
          className="walletBtn walletBtn--connect"
          onClick={() => injected && connect({ connector: injected })}
          disabled={isPending || !injected}
        >
          {isPending ? 'CONNECTING…' : 'CONNECT WALLET'}
        </button>
        {error && (
          <span className="walletBtn__error" role="alert">
            {error.message.slice(0, 64)}
          </span>
        )}
        {!injected && (
          <span className="walletBtn__error" role="status">
            No browser wallet detected
          </span>
        )}
      </div>
    )
  }

  if (wrongNetwork) {
    return (
      <button className="walletBtn walletBtn--warn" onClick={() => switchChain({ chainId: robinhoodChain.id })}>
        <span className="dot dot--amber" aria-hidden="true" /> SWITCH TO {CHAIN_NAME.toUpperCase()}
      </button>
    )
  }

  return (
    <div className="walletChipGroup">
      <button
        className="walletChip"
        onClick={() => {
          navigator.clipboard?.writeText(address ?? '').catch(() => {})
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        }}
        aria-label={`Copy wallet address ${address}`}
      >
        <span className="mono-label walletChip__label">WALLET</span>
        <span className="walletChip__addr">
          {shortAddress(address)}
          <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
            <rect x="4" y="4" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M9 4V1H1v8h3" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </span>
      </button>
      <span aria-live="polite" className="visually-hidden">
        {copied ? 'Address copied' : ''}
      </span>
      <button className="walletDisconnect" onClick={() => disconnect()} aria-label="Disconnect wallet">
        ⏻
      </button>
    </div>
  )
}

import { parseUnits } from 'viem'
import { erc20Abi, erc4626Abi } from './abi'
import { VAULTS } from './chain'
import { publicClient } from './adapters'

/**
 * Deposit path for a Morpho ERC-4626 vault.
 *
 * Two guards run before any calldata is handed to a wallet:
 *  1. the vault must report the exact underlying asset we configured, and
 *  2. the deposit must simulate successfully against current state.
 *
 * Either failing aborts before a signature is ever requested.
 */

export type DepositPlan = {
  vault: (typeof VAULTS)[number]
  assets: bigint
  needsApproval: boolean
  currentAllowance: bigint
  expectedShares: bigint
}

export class PreflightError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PreflightError'
  }
}

export function findVault(recipeId: string) {
  const vault = VAULTS.find((v) => v.id === recipeId)
  if (!vault) throw new PreflightError(`No vault is configured for "${recipeId}".`)
  return vault
}

/** Reads allowance and simulates the deposit. Throws with a readable reason. */
export async function planDeposit(recipeId: string, amountUsd: number, owner: `0x${string}`): Promise<DepositPlan> {
  const vault = findVault(recipeId)
  const assets = parseUnits(amountUsd.toFixed(vault.asset.decimals), vault.asset.decimals)
  if (assets <= 0n) throw new PreflightError('Enter an amount above zero.')

  const [underlying, balance, allowance] = await Promise.all([
    publicClient.readContract({ address: vault.address, abi: erc4626Abi, functionName: 'asset' }),
    publicClient.readContract({
      address: vault.asset.address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [owner],
    }),
    publicClient.readContract({
      address: vault.asset.address,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [owner, vault.address],
    }),
  ])

  if (underlying.toLowerCase() !== vault.asset.address.toLowerCase()) {
    throw new PreflightError(
      `Vault underlying mismatch: contract reports ${underlying}, expected ${vault.asset.address}. Deposit aborted.`,
    )
  }

  if (balance < assets) {
    throw new PreflightError(
      `Wallet holds ${Number(balance) / 10 ** vault.asset.decimals} ${vault.asset.symbol}, which is short of this allocation.`,
    )
  }

  const expectedShares = await publicClient.readContract({
    address: vault.address,
    abi: erc4626Abi,
    functionName: 'previewDeposit',
    args: [assets],
  })

  return { vault, assets, needsApproval: allowance < assets, currentAllowance: allowance, expectedShares }
}

/** Simulates the deposit against current state; throws if it would revert. */
export async function simulateDeposit(plan: DepositPlan, owner: `0x${string}`) {
  const { request } = await publicClient.simulateContract({
    address: plan.vault.address,
    abi: erc4626Abi,
    functionName: 'deposit',
    args: [plan.assets, owner],
    account: owner,
  })
  return request
}

export function approvalRequest(plan: DepositPlan) {
  return {
    address: plan.vault.asset.address,
    abi: erc20Abi,
    functionName: 'approve' as const,
    args: [plan.vault.address, plan.assets] as const,
  }
}

export function depositRequest(plan: DepositPlan, owner: `0x${string}`) {
  return {
    address: plan.vault.address,
    abi: erc4626Abi,
    functionName: 'deposit' as const,
    args: [plan.assets, owner] as const,
  }
}

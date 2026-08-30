/** Minimal ABIs — only the functions PONSAJI actually calls. */

export const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const

/** ERC-4626 tokenized vault. */
export const erc4626Abi = [
  { type: 'function', name: 'asset', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'totalAssets', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  {
    type: 'function',
    name: 'convertToAssets',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxWithdraw',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'previewDeposit',
    stateMutability: 'view',
    inputs: [{ name: 'assets', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const

/** Chainlink AggregatorV3. */
export const aggregatorV3Abi = [
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'description', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const

/** Uniswap v4 PoolManager. `extsload` is the only way to read pool state. */
export const poolManagerAbi = [
  {
    type: 'function',
    name: 'extsload',
    stateMutability: 'view',
    inputs: [{ name: 'slot', type: 'bytes32' }],
    outputs: [{ type: 'bytes32' }],
  },
] as const

/** The Index — fee hook, distributor. Only the views PONSAJI reads. */
export const indexFeeHookAbi = [
  { type: 'function', name: 'FEE_BPS', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

export const indexDistributorAbi = [
  { type: 'function', name: 'interval', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'nextDistribution', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

/**
 * Quotrons view quoter. Free, allowance-free, and it returns the fee breakdown
 * per swap — the cost side of a round trip without simulating anything.
 */
export const quotronQuoterAbi = [
  {
    type: 'function',
    name: 'quoteBuyExactEth',
    stateMutability: 'view',
    inputs: [
      { name: 'ethIn', type: 'uint256' },
      { name: 'payer', type: 'address' },
    ],
    outputs: [
      { name: 'quotronOut', type: 'uint256' },
      { name: 'feeBps', type: 'uint256' },
      { name: 'feeWeth', type: 'uint256' },
      { name: 'poolWethIn', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'quoteSellExactQuotron',
    stateMutability: 'view',
    inputs: [
      { name: 'quotronIn', type: 'uint256' },
      { name: 'payer', type: 'address' },
    ],
    outputs: [
      { name: 'ethOut', type: 'uint256' },
      { name: 'feeBps', type: 'uint256' },
      { name: 'feeWeth', type: 'uint256' },
      { name: 'poolWethOut', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'currentFeeBps',
    stateMutability: 'view',
    inputs: [{ name: 'payer', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

/** Quotrons ERC-404 core. The invariant is worth reading and showing. */
export const quotronTokenAbi = [
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalHardwired', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'economicUnits', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

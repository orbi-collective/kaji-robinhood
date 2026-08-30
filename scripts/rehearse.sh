#!/usr/bin/env bash
#
# Launch-day dress rehearsal.
#
# Drives the real crank end to end against a throwaway chain: plan, approve,
# batch-disperse, then reproduce the split from raw logs with code that shares
# nothing with the payroll engine. The mainnet fork route is unavailable because
# the upstream RPC keeps no archive, so the chain is built from scratch instead.
#
# Every contract here is a stand-in and none of them is deployed anywhere real.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=8556
RPC=http://127.0.0.1:$PORT
# Anvil's well-known default account #0. It is published in Foundry's own docs,
# it only exists on the throwaway chain this script starts, and it must never be
# swapped for a real key: this script sends every payout it plans.
KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
PAYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
FEED=0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9
POOL_MANAGER=0x8366a39CC670B4001A1121B8F6A443A643e40951

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
deploy() { forge create "$1" --rpc-url $RPC --private-key $KEY --broadcast 2>&1 | grep -oE 'Deployed to: 0x[a-fA-F0-9]{40}' | awk '{print $3}'; }
etch() { cast rpc anvil_setCode "$1" "$(cast code "$2" --rpc-url $RPC)" --rpc-url $RPC >/dev/null; }

say "fresh chain on :$PORT"
lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
anvil --port $PORT --chain-id 4663 --silent &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null || true' EXIT
until cast block-number --rpc-url $RPC >/dev/null 2>&1; do :; done

say "deploying"
forge build >/dev/null
DISPERSER=$(deploy contracts/src/PonsajiPayroll.sol:PonsajiPayroll)
TOKEN=$(deploy contracts/src/MockPayout.sol:MockPayout)
PAYOUT=$(deploy contracts/src/MockPayout.sol:MockPayout)
etch $FEED "$(deploy contracts/src/MockFeed.sol:MockFeed)"
etch $POOL_MANAGER "$(deploy contracts/src/MockPoolManager.sol:MockPoolManager)"
echo "  disperser $DISPERSER"
echo "  token     $TOKEN"
echo "  payout    $PAYOUT"

# Balances rise while hold times fall, so the split cannot be reproduced by
# sorting on either one alone — only the integral of the two gets it right.
say "seeding six holders, ten minutes apart"
for i in 1 2 3 4 5 6; do
  W=$(printf '0x%040d' $i)
  cast send $TOKEN "mint(address,uint256)" $W "$((i * 1000))000000000000000000000" \
    --rpc-url $RPC --private-key $KEY >/dev/null
  cast rpc evm_increaseTime 600 --rpc-url $RPC >/dev/null
  cast rpc evm_mine --rpc-url $RPC >/dev/null
done
cast send $PAYOUT "mint(address,uint256)" $PAYER 100000000000000000000 \
  --rpc-url $RPC --private-key $KEY >/dev/null

export RPC_URL=$RPC VITE_RPC_URL=$RPC VITE_CHAIN_ID=4663 \
  PONSAJI_TOKEN_ADDRESS=$TOKEN PONSAJI_PAYROLL_ACCOUNT=$PAYER \
  PONSAJI_PAYROLL_CONTRACT=$DISPERSER PONSAJI_PAYOUT_ADDRESS=$PAYOUT PONSAJI_PAYOUT_SYMBOL=RSPCX \
  PAYROLL_PRIVATE_KEY=$KEY

say "crank"
rm -rf payroll
npm run --silent crank:execute

say "custody"
bal() { cast call $PAYOUT 'balanceOf(address)(uint256)' "$1" --rpc-url $RPC | awk '{print $1}'; }
printf '  payer left      %s (0)\n' "$(bal $PAYER)"
printf '  disperser holds %s (0)\n' "$(bal $DISPERSER)"
printf '  allowance left  %s (0)\n' "$(cast call $PAYOUT 'allowance(address,address)(uint256)' $PAYER $DISPERSER --rpc-url $RPC | awk '{print $1}')"

say "independent reproduction"
npx --yes tsx scripts/crosscheck.ts

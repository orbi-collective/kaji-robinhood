// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Stand-in v4 PoolManager for rehearsals: answers every slot with one
///      initialised slot0, so the price path can be exercised for real on a
///      chain that has no pools. Never deployed to mainnet.
contract MockPoolManager {
    /// sqrtPriceX96 = 2**96 * 1e6  →  1 payout token = 1 USDG (18 vs 6 decimals)
    uint256 private constant SQRT_PRICE_X96 = 79228162514264337593543950336000000;

    function extsload(bytes32) external pure returns (bytes32) {
        return bytes32(SQRT_PRICE_X96);
    }
}

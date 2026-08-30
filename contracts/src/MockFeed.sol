// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Stand-in Chainlink aggregator for rehearsals on a chain that has none.
contract MockFeed {
    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, 2_486_85000000, block.timestamp, block.timestamp, 1);
    }

    function decimals() external pure returns (uint8) {
        return 8;
    }
}

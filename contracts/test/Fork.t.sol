// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {PonsajiPayroll, IERC20} from "../src/PonsajiPayroll.sol";

interface IERC20Full is IERC20 {
    function balanceOf(address) external view returns (uint256);
    function allowance(address, address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
}

/// @dev Runs the contract against the real payout asset on a fork of Robinhood
/// Chain, because a mock token proves the contract works and proves nothing
/// about the token it will actually be pointed at. SPCX is a beacon proxy with
/// a pause switch, and that is exactly the shape a mock does not have.
///
///   forge test --match-contract ForkTest --fork-url https://rpc.mainnet.chain.robinhood.com
contract ForkTest is Test {
    IERC20Full constant SPCX = IERC20Full(0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa);

    PonsajiPayroll payroll;
    address payer = address(0xA11CE);

    function setUp() public {
        // Skips cleanly when run without --fork-url.
        if (address(SPCX).code.length == 0) return;
        payroll = new PonsajiPayroll();
    }

    function test_dispersesRealSPCX() public {
        // Reported as SKIPPED, never as PASSED. A green test that quietly did
        // nothing is worse than a red one: it is a claim of coverage that does
        // not exist, and this is the test that proves the real token works.
        vm.skip(address(SPCX).code.length == 0);

        assertEq(SPCX.decimals(), 18, "decimals changed");
        assertEq(SPCX.symbol(), "SPCX", "symbol changed");

        deal(address(SPCX), payer, 100 ether);
        assertEq(SPCX.balanceOf(payer), 100 ether, "deal failed");

        address[] memory r = new address[](3);
        uint256[] memory a = new uint256[](3);
        r[0] = address(0xA1);
        r[1] = address(0xB2);
        r[2] = address(0xC3);
        a[0] = 1 ether;
        a[1] = 2 ether;
        a[2] = 3 ether;

        vm.startPrank(payer);
        SPCX.approve(address(payroll), 6 ether);
        payroll.disperse(IERC20(address(SPCX)), r, a);
        vm.stopPrank();

        assertEq(SPCX.balanceOf(address(0xA1)), 1 ether);
        assertEq(SPCX.balanceOf(address(0xB2)), 2 ether);
        assertEq(SPCX.balanceOf(address(0xC3)), 3 ether);
        assertEq(SPCX.balanceOf(payer), 94 ether);
        assertEq(SPCX.balanceOf(address(payroll)), 0, "contract must never hold");
    }

    /// A full-size batch against the real token, which is the transaction the
    /// crank will actually send. Proves both that it fits and what it costs.
    function test_fullBatchOfRealSPCX() public {
        // Reported as SKIPPED, never as PASSED. A green test that quietly did
        // nothing is worse than a red one: it is a claim of coverage that does
        // not exist, and this is the test that proves the real token works.
        vm.skip(address(SPCX).code.length == 0);

        uint256 n = 400;
        deal(address(SPCX), payer, 1000 ether);

        address[] memory r = new address[](n);
        uint256[] memory a = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            r[i] = address(uint160(0x5A11000000 + i));
            a[i] = 0.001 ether * (i + 1);
        }
        uint256 total = payroll.totalOf(a);

        vm.startPrank(payer);
        SPCX.approve(address(payroll), total);
        uint256 before = gasleft();
        payroll.disperse(IERC20(address(SPCX)), r, a);
        uint256 used = before - gasleft();
        vm.stopPrank();

        console.log("recipients paid in one transaction:", n);
        console.log("gas used:", used);
        console.log("gas per recipient:", used / n);

        // Every leg landed, exactly.
        for (uint256 i; i < n; ++i) {
            assertEq(SPCX.balanceOf(r[i]), a[i], "recipient underpaid");
        }
        assertEq(SPCX.balanceOf(address(payroll)), 0, "contract must never hold");
        // And the approval is spent to nothing, leaving no standing allowance.
        assertEq(SPCX.allowance(payer, address(payroll)), 0, "allowance left over");
    }
}

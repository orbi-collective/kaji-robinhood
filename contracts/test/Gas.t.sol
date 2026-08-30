// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {PonsajiPayroll, IERC20} from "../src/PonsajiPayroll.sol";

contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a;
        balanceOf[f] -= a;
        balanceOf[t] += a;
        return true;
    }
}

/// @dev Sizes a batch against a real block, so the crank's limit is measured
/// rather than picked. Every recipient is a fresh address, which is the
/// expensive case and the realistic one for a payroll.
contract GasTest is Test {
    PonsajiPayroll payroll;
    MockToken token;
    address payer = address(0xA11CE);

    function setUp() public {
        payroll = new PonsajiPayroll();
        token = new MockToken();
        token.mint(payer, type(uint128).max);
        vm.prank(payer);
        token.approve(address(payroll), type(uint256).max);
    }

    function test_gasPerRecipient() public {
        console.log("recipients |      gas | per recipient");
        uint256 firstPerRecipient;
        for (uint256 n = 50; n <= 500; n += 50) {
            address[] memory r = new address[](n);
            uint256[] memory a = new uint256[](n);
            for (uint256 i; i < n; ++i) {
                // Offset by n so each run pays fresh addresses.
                r[i] = address(uint160(0x1000000 + n * 1_000_000 + i));
                a[i] = 1 ether;
            }
            vm.prank(payer);
            uint256 before = gasleft();
            payroll.disperse(IERC20(address(token)), r, a);
            uint256 used = before - gasleft();
            uint256 perRecipient = used / n;
            console.log(n, used, perRecipient);

            // The cost that matters is per recipient, and it must stay flat.
            // A superlinear term would make large batches quietly unaffordable
            // and is exactly what a loop over calldata could hide.
            if (firstPerRecipient == 0) firstPerRecipient = perRecipient;
            else assertLt(perRecipient, (firstPerRecipient * 11) / 10);
        }
    }
}

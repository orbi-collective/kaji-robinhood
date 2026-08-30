// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PonsajiPayroll, IERC20} from "../src/PonsajiPayroll.sol";

/// @dev A normal ERC-20 that returns bool.
contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public paused;
    mapping(address => bool) public frozen;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function setPaused(bool v) external {
        paused = v;
    }

    function freeze(address who, bool v) external {
        frozen[who] = v;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(!paused, "paused");
        require(!frozen[to], "frozen");
        require(balanceOf[from] >= amount, "balance");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev A token that returns nothing at all, like USDT. A bare call reverts.
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transferFrom(address from, address to, uint256 amount) external {
        require(balanceOf[from] >= amount && allowance[from][msg.sender] >= amount, "no");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

/// @dev A token that reports failure by returning false instead of reverting.
contract LyingToken {
    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}

contract PonsajiPayrollTest is Test {
    PonsajiPayroll payroll;
    MockToken token;

    address payer = address(0xA11CE);
    address alice = address(0xA1);
    address bob = address(0xB0B);
    address carol = address(0xCA401);

    function setUp() public {
        payroll = new PonsajiPayroll();
        token = new MockToken();
        token.mint(payer, 1_000_000 ether);
        vm.prank(payer);
        token.approve(address(payroll), type(uint256).max);
    }

    function _three() internal view returns (address[] memory r, uint256[] memory a) {
        r = new address[](3);
        a = new uint256[](3);
        (r[0], r[1], r[2]) = (alice, bob, carol);
        (a[0], a[1], a[2]) = (1 ether, 2 ether, 3 ether);
    }

    function test_paysEveryRecipientExactly() public {
        (address[] memory r, uint256[] memory a) = _three();
        vm.prank(payer);
        payroll.disperse(IERC20(address(token)), r, a);

        assertEq(token.balanceOf(alice), 1 ether);
        assertEq(token.balanceOf(bob), 2 ether);
        assertEq(token.balanceOf(carol), 3 ether);
        assertEq(token.balanceOf(payer), 1_000_000 ether - 6 ether);
    }

    /// The contract must never end a call holding anything.
    function test_neverHoldsABalance() public {
        (address[] memory r, uint256[] memory a) = _three();
        vm.prank(payer);
        payroll.disperse(IERC20(address(token)), r, a);
        assertEq(token.balanceOf(address(payroll)), 0);
    }

    /// The property the whole design rests on: an approval to this contract is
    /// useless to anybody but the approver.
    function test_cannotSpendSomeoneElsesAllowance() public {
        address attacker = address(0xBAD);
        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = attacker;
        a[0] = 500 ether;

        // The attacker calls with the payer's approval sitting on the contract.
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(PonsajiPayroll.TransferFailed.selector, attacker, 0));
        payroll.disperse(IERC20(address(token)), r, a);

        assertEq(token.balanceOf(attacker), 0);
        assertEq(token.balanceOf(payer), 1_000_000 ether);
    }

    function test_revertsWholeBatchWhenOneLegFails() public {
        token.freeze(bob, true);
        (address[] memory r, uint256[] memory a) = _three();

        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(PonsajiPayroll.TransferFailed.selector, bob, 1));
        payroll.disperse(IERC20(address(token)), r, a);

        // Nothing partial: alice was first in the batch and still received nothing.
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.balanceOf(carol), 0);
    }

    function test_revertsWhenTokenIsPaused() public {
        token.setPaused(true);
        (address[] memory r, uint256[] memory a) = _three();
        vm.prank(payer);
        vm.expectRevert();
        payroll.disperse(IERC20(address(token)), r, a);
    }

    function test_rejectsMismatchedArrays() public {
        address[] memory r = new address[](2);
        uint256[] memory a = new uint256[](3);
        vm.prank(payer);
        vm.expectRevert(PonsajiPayroll.LengthMismatch.selector);
        payroll.disperse(IERC20(address(token)), r, a);
    }

    function test_rejectsEmptyBatch() public {
        vm.prank(payer);
        vm.expectRevert(PonsajiPayroll.EmptyBatch.selector);
        payroll.disperse(IERC20(address(token)), new address[](0), new uint256[](0));
    }

    /// USDT-style tokens return nothing; a bare call would revert on decode.
    function test_handlesTokensThatReturnNothing() public {
        NoReturnToken quiet = new NoReturnToken();
        quiet.mint(payer, 100 ether);
        vm.prank(payer);
        quiet.approve(address(payroll), 100 ether);

        (address[] memory r, uint256[] memory a) = _three();
        vm.prank(payer);
        payroll.disperse(IERC20(address(quiet)), r, a);
        assertEq(quiet.balanceOf(bob), 2 ether);
    }

    /// A token reporting failure by returning false must not pass silently.
    function test_catchesTokensThatReturnFalse() public {
        LyingToken liar = new LyingToken();
        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = alice;
        a[0] = 1 ether;

        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(PonsajiPayroll.TransferFailed.selector, alice, 0));
        payroll.disperse(IERC20(address(liar)), r, a);
    }

    function test_totalOfMatchesWhatIsSpent() public {
        (address[] memory r, uint256[] memory a) = _three();
        uint256 before = token.balanceOf(payer);
        uint256 quoted = payroll.totalOf(a);

        vm.prank(payer);
        payroll.disperse(IERC20(address(token)), r, a);
        assertEq(before - token.balanceOf(payer), quoted);
    }

    /// An approval sized exactly to the run must be fully consumed and no more.
    function test_consumesExactlyTheApproval() public {
        address tight = address(0x7157);
        token.mint(tight, 6 ether);
        vm.prank(tight);
        token.approve(address(payroll), 6 ether);

        (address[] memory r, uint256[] memory a) = _three();
        vm.prank(tight);
        payroll.disperse(IERC20(address(token)), r, a);

        assertEq(token.allowance(tight, address(payroll)), 0);
        assertEq(token.balanceOf(tight), 0);
    }

    function testFuzz_paysAnyBatchExactly(uint8 count, uint96 unit) public {
        vm.assume(count > 0 && count <= 100);
        vm.assume(unit > 0 && unit < 1 ether);

        address[] memory r = new address[](count);
        uint256[] memory a = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            r[i] = address(uint160(0x10000 + i));
            a[i] = uint256(unit) * (i + 1);
        }

        uint256 expected = payroll.totalOf(a);
        uint256 before = token.balanceOf(payer);

        vm.prank(payer);
        payroll.disperse(IERC20(address(token)), r, a);

        assertEq(before - token.balanceOf(payer), expected);
        for (uint256 i; i < count; ++i) {
            assertEq(token.balanceOf(r[i]), a[i]);
        }
        assertEq(token.balanceOf(address(payroll)), 0);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title PonsajiPayroll
/// @notice Pays many wallets one token in a single transaction.
///
/// @dev Written to be small enough to read in full, because it is unaudited and
/// it moves other people's money.
///
/// Three properties do the safety work, and all three come from one line: every
/// transfer is `transferFrom(msg.sender, ...)`.
///
///   1. It can only ever spend the caller's own allowance. An approval granted
///      to this contract is useless to anybody else — there is no argument that
///      lets a caller name a different payer.
///   2. It never holds a balance. Tokens move payer to recipient directly, so
///      there is nothing here to strand, sweep or rescue, and no state to get
///      out of step with a balance.
///   3. It has no owner, no pause, no upgrade path and no admin function. There
///      is nothing to trust beyond the code below.
///
/// A failed leg reverts the whole batch. A partial payroll is worse than a
/// failed one: the failure is retryable and leaves the ledger consistent, while
/// a partial run silently pays some holders and not others. The caller is
/// expected to fall back to individual sends to find the offending recipient —
/// which matters here because the tokenized stocks on this chain are pausable
/// and upgradeable, so a recipient can become untransferable without warning.
contract PonsajiPayroll {
    /// @notice `recipients` and `amounts` were different lengths.
    error LengthMismatch();
    /// @notice Nothing was passed to pay.
    error EmptyBatch();
    /// @notice A leg failed. Carries the index so the caller can find it.
    error TransferFailed(address recipient, uint256 index);

    /// @notice One completed batch. The audit trail for a payroll run.
    event Dispersed(address indexed token, address indexed payer, uint256 recipients, uint256 total);

    /// @notice Sends `amounts[i]` of `token` to `recipients[i]`, from the caller.
    /// @dev The caller must have approved this contract for at least the sum.
    ///      Reverts on the first failure, naming the index.
    function disperse(IERC20 token, address[] calldata recipients, uint256[] calldata amounts) external {
        uint256 n = recipients.length;
        if (n != amounts.length) revert LengthMismatch();
        if (n == 0) revert EmptyBatch();

        uint256 total;
        for (uint256 i; i < n; ++i) {
            uint256 amount = amounts[i];
            total += amount;
            _transferFrom(token, recipients[i], amount, i);
        }

        emit Dispersed(address(token), msg.sender, n, total);
    }

    /// @notice The sum of `amounts`, so a caller can size its approval exactly.
    /// @dev A view rather than a promise: approving more than a run needs leaves
    ///      standing allowance on a contract nobody has audited.
    function totalOf(uint256[] calldata amounts) external pure returns (uint256 total) {
        for (uint256 i; i < amounts.length; ++i) {
            total += amounts[i];
        }
    }

    /// @dev Handles tokens that return nothing as well as tokens that return a
    ///      bool. A bare `transferFrom` call would revert on the former and
    ///      silently ignore a `false` from the latter.
    function _transferFrom(IERC20 token, address to, uint256 amount, uint256 index) private {
        (bool ok, bytes memory data) =
            address(token).call(abi.encodeCall(IERC20.transferFrom, (msg.sender, to, amount)));

        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed(to, index);
        }
    }
}

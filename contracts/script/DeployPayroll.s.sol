// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {PonsajiPayroll} from "../src/PonsajiPayroll.sol";

/// @dev Deploys the batch sender.
///
///   forge script contracts/script/DeployPayroll.s.sol \
///     --rpc-url https://rpc.mainnet.chain.robinhood.com \
///     --private-key $PAYROLL_PRIVATE_KEY --broadcast
///
/// The contract has no constructor arguments, no owner and no initialiser, so
/// there is nothing to get wrong after it lands and nothing to configure.
contract DeployPayroll is Script {
    function run() external {
        vm.startBroadcast();
        PonsajiPayroll payroll = new PonsajiPayroll();
        vm.stopBroadcast();

        console.log("PonsajiPayroll deployed at:", address(payroll));
        console.log("Put this in src/lib/ponsajiToken.ts as payrollContract.");
    }
}

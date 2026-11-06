// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice What Pause The Target needs from a protocol it guards from the outside: a pause the build is allowed to call
///         (grant the build the pauser role), and a view of the flag.
interface IPausable {
    function pause() external;
    function paused() external view returns (bool);
}

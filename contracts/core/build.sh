#!/usr/bin/env bash
# Builds Popcorn Core with the solc from scripts/install-solc.sh.
#   contracts/core/out/PopcornCore.bin          creation code (append the 101 argument bytes + 84 owner bytes to deploy)
#   contracts/core/out/PopcornCore.runtime.bin  runtime code (deployed code = runtime ++ args)
#   contracts/core/out/PopcornCore.json         {creation, runtime, argsLength, layout}
# The runtime is compiled from the same source (its sub-object extracted) and must equal the tail of the
# creation code byte for byte; the script fails otherwise.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
SOLC="${SOLC:-${SVM_HOME:-$HOME/.local/share/svm}/0.8.33/solc-0.8.33}"
[[ -x "$SOLC" ]] || { echo "solc not found at $SOLC; run scripts/install-solc.sh" >&2; exit 1; }
EVM=prague
out="$here/out"; mkdir -p "$out"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

compile() { "$SOLC" --strict-assembly --optimize --evm-version "$EVM" --bin "$1" | awk '/^Binary representation:/{getline; print}'; }

creation="$(compile "$here/PopcornCore.yul")"
python3 - "$here/PopcornCore.yul" "$tmp/runtime.yul" <<'PY'
import sys
src = open(sys.argv[1]).read()
i = src.index('object "runtime"')
depth, j = 0, src.index("{", i)
for k in range(j, len(src)):
    if src[k] == "{": depth += 1
    elif src[k] == "}":
        depth -= 1
        if depth == 0: break
open(sys.argv[2], "w").write(src[i:k + 1] + "\n")
PY
runtime="$(compile "$tmp/runtime.yul")"
[[ -n "$creation" && -n "$runtime" && "$creation" == *"$runtime" ]] || { echo "runtime is not the tail of creation" >&2; exit 1; }

printf '%s\n' "$creation" > "$out/PopcornCore.bin"
printf '%s\n' "$runtime" > "$out/PopcornCore.runtime.bin"
python3 - "$creation" "$runtime" "$out/PopcornCore.json" "$("$SOLC" --version | tail -1)" "$EVM" <<'PY'
import json, sys
creation, runtime, path, version, evm = sys.argv[1:6]
layout = [
    {"name": "logic", "offset": 0, "bytes": 20, "type": "address"},
    {"name": "mode", "offset": 20, "bytes": 1, "type": "uint8", "values": {"0": "rule-pays", "1": "caller-pays"}, "note": "deploy rejects any mode > 1"},
    {"name": "maxFeePerGas", "offset": 21, "bytes": 16, "type": "uint128"},
    {"name": "maxPriorityFeePerGas", "offset": 37, "bytes": 16, "type": "uint128"},
    {"name": "maxGasPerFrame", "offset": 53, "bytes": 8, "type": "uint64"},
    {"name": "maxStateGasPerFrame", "offset": 61, "bytes": 8, "type": "uint64"},
    {"name": "verifier", "offset": 69, "bytes": 20, "type": "address"},
    {"name": "conditionGas", "offset": 89, "bytes": 4, "type": "uint32"},
    {"name": "maxVerifyDataLength", "offset": 93, "bytes": 4, "type": "uint32"},
    {"name": "maxPopArgsLength", "offset": 97, "bytes": 4, "type": "uint32"},
]
assert sum(f["bytes"] for f in layout) == 101
json.dump({
    "contract": "PopcornCore", "version": "1", "compiler": version, "evmVersion": evm,
    "creation": "0x" + creation, "runtime": "0x" + runtime,
    "argsLength": 101, "initArgsLength": 185, "layout": layout,
    "ownerInit": [{"name": "ownerEcdsa", "offset": 0, "bytes": 20}, {"name": "wotsRoot", "offset": 20, "bytes": 32}, {"name": "wotsPubSeed", "offset": 52, "bytes": 32}],
    "constants": {"nonceKeyGas": 10000, "mandatoryGas": 12950, "floorPerByte": 64, "nonceRlpBytes": 35,
                  "verifyFixedGas": 7000, "lockSlot": "0x9dd81f995770cdac1e5604925d6a5e0e08886ca48a9ea18085a511ab38ae2d13",
                  "ownerKey": "0x7359ba52ecb8339ef831f17cc090648772bae5bfd6b471cb80453e37c92f8c5c",
                  "ownerBase": "0x6c5153798c380854dc793bae6a86335313b83f008f4ecf20cd663a8aa18e7c27",
                  "ownerFlagSlot": "0x4257847a835ea5fd0672322af0942e7be8da7acf8d7dedb7dd4ccbeeb6bdf7bf"},
    "selectors": {"pop(bytes)": "0xd9292504", "__nonceKey(bytes)": "0x97031c8c",
                  "__condition(bytes,bytes)": "0x05f661f0", "__action(bytes,address)": "0x6019566d",
                  "owner(bytes)": "0xbd27b241", "ownerBump()": "0x91b5d060"},
}, open(path, "w"), indent=2)
PY
# Test-only stubs (contracts/test/CoreSelfCall.t.sol): the same source with the frame opcodes replaced by constants, so
# Foundry can run the SENDER routine "inside another account's frame tx" (never deployed):
#   stub-foreign: executing frame 1 is a SENDER frame, tx.sender = 0xdead (not the rule contract)       -> must revert 0x3b
#   stub-frame2:  executing frame 2 is a SENDER frame, tx.sender = the rule contract                    -> must revert 0x3c
#   stub-sp:      executing frame 2 is a SENDER frame, tx.sender = the rule contract, FRAMEPARAM(target, 1) = 0xb0b
#                 -> a mode-1 rule contract runs __action with payer 0xb0b; a mode-0 one reverts 0x3c
#   stub-frame1:  as stub-sp but executing frame 1 -> a mode-1 rule contract reverts 0x3c
stub() {
  python3 - "$here/PopcornCore.yul" "$tmp/$1.yul" "$2" "$3" <<'PY'
import sys
src, dst, sender, idx = sys.argv[1:5]
s = open(src).read()
a = 'function txparam(id) -> v { v := verbatim_1i_1o(hex"b0", id) }'
b = 'function frameparam(param, idx) -> v { v := verbatim_2i_1o(hex"b3", idx, param) }'
assert a in s and b in s
s = s.replace(a, 'function txparam(id) -> v { v := %s if eq(id, 0x02) { v := %s } }' % (idx, sender))
s = s.replace(b, 'function frameparam(param, idx) -> v { v := 2 if and(iszero(param), eq(idx, 1)) { v := 0xb0b } }')
open(dst, "w").write(s)
PY
  compile "$tmp/$1.yul" > "$out/PopcornCore.$1.bin"
}
stub stub-foreign 0xdead 1
stub stub-frame2 "address()" 2
stub stub-sp "address()" 2
stub stub-frame1 "address()" 1

# Test-only WOTS harness (contracts/test/CoreWots.t.sol): wotsVerify and wotsChain copied VERBATIM out of PopcornCore.yul, wrapped
# so Foundry can run Core's own verifier against the TypeScript signer's vectors (differential test; the signature sits at 0x80
# as in verifyOwner). calldata: root ++ pubSeed ++ leaf ++ msg ++ 2,464 signature bytes; returns the verdict word.
python3 - "$here/PopcornCore.yul" "$tmp/wots.yul" <<'PY2'
import sys
src = open(sys.argv[1]).read()
a = src.index("function wotsVerify(")
b = src.index("function wotsChain(")
end = src.index("\n      }\n", b) + len("\n      }\n")
fns = src[a:end]
open(sys.argv[2], "w").write('object "WotsHarness" { code { datacopy(0, dataoffset("r"), datasize("r")) return(0, datasize("r")) }\n object "r" { code {\n'
  '  calldatacopy(0x80, 128, 2464)\n  mstore(0, wotsVerify(calldataload(0), calldataload(32), calldataload(64), calldataload(96)))\n  return(0, 32)\n' + fns + '\n}}}\n')
PY2
compile "$tmp/wots.yul" > "$out/PopcornCore.wots-harness.bin"

echo "creation $(( ${#creation} / 2 )) bytes, runtime $(( ${#runtime} / 2 )) bytes -> $out"

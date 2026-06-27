import { type Address } from "viem";
import splitVaultArtifact from "./SplitVaultArtifact.json";

// Legacy demo project — kept as a fallback default, no longer the only vault.
export const VAULT_ADDRESS: Address =
  "0x2DB3dbDA6C5F5CfF3234CDBadD049D90412c1774";

export const USDC_ADDRESS: Address =
  "0x3600000000000000000000000000000000000000";

export const SPLIT_VAULT_BYTECODE = splitVaultArtifact.bytecode as `0x${string}`;

export const VAULT_ABI = [
  {
    name: "initialize",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_projectName", type: "string" },
      { name: "_usdcToken", type: "address" },
      { name: "_wallets", type: "address[]" },
      { name: "_percentages", type: "uint256[]" },
      { name: "_roles", type: "string[]" },
    ],
    outputs: [],
  },
  {
    name: "initialized",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    name: "getProjectInfo",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "usdcToken", type: "address" },
          { name: "totalDeposited", type: "uint256" },
          { name: "totalDistributed", type: "uint256" },
          { name: "pendingBalance", type: "uint256" },
          { name: "initialized", type: "bool" },
          { name: "paused", type: "bool" },
          { name: "contributorCount", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "getContributors",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "wallet", type: "address" },
          { name: "percentage", type: "uint256" },
          { name: "totalPaid", type: "uint256" },
          { name: "role", type: "string" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
  {
    name: "previewShare",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_wallet", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "depositRevenue",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "distribute",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "distributePartial",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "replaceContributors",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_wallets", type: "address[]" },
      { name: "_percentages", type: "uint256[]" },
      { name: "_roles", type: "string[]" },
    ],
    outputs: [],
  },
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    name: "paused",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
] as const;

// Full compiler-generated ABI (includes constructor) — used only for deploying
// a brand new SplitVault via useDeployContract(). Use VAULT_ABI above for
// reading/writing to an already-deployed vault.
export const SPLIT_VAULT_DEPLOY_ABI = splitVaultArtifact.abi;

export const USDC_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

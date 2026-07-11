export const PROOFSCORE_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_PROOFSCORE_V9_ADDRESS ?? '0x0000000000000000000000000000000000000000'
export const PROOFSCORE_IS_CONFIGURED = /^0x[a-fA-F0-9]{40}$/.test(PROOFSCORE_CONTRACT_ADDRESS) && !/^0x0{40}$/.test(PROOFSCORE_CONTRACT_ADDRESS)
export const BRADBURY_RPC = process.env.NEXT_PUBLIC_GENLAYER_RPC ?? 'https://rpc-bradbury.genlayer.com'
export const BRADBURY_EXPLORER = 'https://explorer-bradbury.genlayer.com'
export const BRADBURY_CHAIN_ID = 4221

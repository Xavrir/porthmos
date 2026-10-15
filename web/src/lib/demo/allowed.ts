export const DEMO_CHAIN_ID = 31337

export const DEMO_BUILD_ALLOWED = !import.meta.env.VITE_TARGET_CHAIN_ID || import.meta.env.VITE_TARGET_CHAIN_ID === String(DEMO_CHAIN_ID)

export function demoIdentitiesAvailable(chainId: number | undefined): boolean {
  return DEMO_BUILD_ALLOWED && chainId === DEMO_CHAIN_ID
}

// Month rules apply to unpublished results; saved history keeps its own rule.
export const COLLABORATION_PEER_ONLY_EFFECTIVE_MONTH = '2026-11';
export function collaborationPolicy(month) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000')) throw Error('invalid_month');
  const peersOnly = month >= COLLABORATION_PEER_ONLY_EFFECTIVE_MONTH;
  return {rule: peersOnly ? 'peers_100' : 'weighted_30_70', weights: {manager: peersOnly ? 0 : 30, peers: peersOnly ? 100 : 70}, effectiveMonth: COLLABORATION_PEER_ONLY_EFFECTIVE_MONTH};
}

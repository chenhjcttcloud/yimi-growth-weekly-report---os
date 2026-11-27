export type CollaborationPolicy = {
  rule: 'peers_100' | 'weighted_30_70';
  weights: {manager: number; peers: number};
  effectiveMonth: string;
};

// The owner confirmed this boundary. Response policies take precedence, and a
// saved result always takes precedence over a present-day monthly policy.
export const PEER_ONLY_EFFECTIVE_MONTH = '2026-11';
export function collaborationPolicyFor(month: string, ...sources: any[]): CollaborationPolicy {
  for (const source of sources) {
    if (!source) continue;
    if (source.month && source.month !== month || source.scopeMonth && source.scopeMonth !== month) continue;
    const savedRule = source.scoring_rule || source.collaborationRule;
    const result = source.result || source;
    const mode = result.publicationMode;
    if (savedRule === 'weighted_30_70' || savedRule === 'legacy' || mode === 'weighted_30_70') return {rule: 'weighted_30_70', weights: {manager: 30, peers: 70}, effectiveMonth: PEER_ONLY_EFFECTIVE_MONTH};
    if (savedRule === 'peers_100' || mode === 'peers_only') return {rule: 'peers_100', weights: {manager: 0, peers: 100}, effectiveMonth: PEER_ONLY_EFFECTIVE_MONTH};
    if (result.weights?.manager === 30 && result.weights?.peers === 70) return {rule: 'weighted_30_70', weights: {manager: 30, peers: 70}, effectiveMonth: PEER_ONLY_EFFECTIVE_MONTH};
    if (result.weights?.manager === 0 && result.weights?.peers === 100) return {rule: 'peers_100', weights: {manager: 0, peers: 100}, effectiveMonth: PEER_ONLY_EFFECTIVE_MONTH};
    const policy = source.collaborationPolicy || source;
    if (policy.rule === 'peers_100' || policy.rule === 'weighted_30_70') {
      const effectiveMonth = policy.effectiveMonth || PEER_ONLY_EFFECTIVE_MONTH;
      // An unscoped legacy response may contain several months. Its top-level
      // policy describes the current month, so apply its boundary to the month
      // being displayed instead of relabeling an older row with today's rule.
      const peerOnly = /^\d{4}-\d{2}$/.test(month) ? month >= effectiveMonth : policy.rule === 'peers_100';
      return {rule: peerOnly ? 'peers_100' : 'weighted_30_70', weights: peerOnly ? {manager: 0, peers: 100} : {manager: 30, peers: 70}, effectiveMonth};
    }
  }
  const peerOnly = month >= PEER_ONLY_EFFECTIVE_MONTH;
  return {rule: peerOnly ? 'peers_100' : 'weighted_30_70', weights: {manager: peerOnly ? 0 : 30, peers: peerOnly ? 100 : 70}, effectiveMonth: PEER_ONLY_EFFECTIVE_MONTH};
}
export const isPeersOnly = (month: string, ...sources: any[]) => collaborationPolicyFor(month, ...sources).rule === 'peers_100';
export function collaborationRuleText(month: string, ...sources: any[]) {
  if (sources.some(source => source?.scoring_rule === 'legacy' || source?.collaborationRule === 'legacy')) return '历史原评分口径';
  return isPeersOnly(month, ...sources) ? '同事互评100%' : '负责人或老板30%＋同事互评70%';
}
export function lastWeightedMonth(effectiveMonth = PEER_ONLY_EFFECTIVE_MONTH) {
  const date = new Date(effectiveMonth + '-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

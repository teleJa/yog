export function refreshEvidence(options = {}) {
  return {
    refreshed: false,
    issues: [
      {
        severity: 'P2',
        message: 'Evidence refresh is not implemented in the first version.',
        details: { provider: options.provider ?? 'none' },
      },
    ],
  };
}

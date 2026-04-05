import type { ContextItem } from '@/lib/api';

export const shouldAutoSwitchToSummary = (opts: {
  hasSummary: boolean;
  viewedSummary: boolean;
  userChoseTranscript: boolean;
}) => {
  return opts.hasSummary && !opts.viewedSummary && !opts.userChoseTranscript;
};

export const nextViewedSummary = (target: 'summary' | 'transcript') => {
  return target === 'summary';
};

export const removeContextItemAtIndex = (items: ContextItem[], index: number) => {
  return items.filter((_, i) => i !== index);
};

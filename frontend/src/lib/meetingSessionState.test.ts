import { describe, expect, it } from 'vitest';

import { nextViewedSummary, removeContextItemAtIndex, shouldAutoSwitchToSummary } from './meetingSessionState';

describe('meetingSessionState helpers', () => {
  it('auto-opens summary only when user did not force transcript view', () => {
    expect(
      shouldAutoSwitchToSummary({
        hasSummary: true,
        viewedSummary: false,
        userChoseTranscript: false,
      }),
    ).toBe(true);

    expect(
      shouldAutoSwitchToSummary({
        hasSummary: true,
        viewedSummary: false,
        userChoseTranscript: true,
      }),
    ).toBe(false);
  });

  it('switches view state between summary and transcript', () => {
    expect(nextViewedSummary('summary')).toBe(true);
    expect(nextViewedSummary('transcript')).toBe(false);
  });

  it('removes context item by index', () => {
    const items = [
      { type: 'text' as const, name: 'a', content: '1' },
      { type: 'file' as const, name: 'b', content: '2' },
      { type: 'text' as const, name: 'c', content: '3' },
    ];

    expect(removeContextItemAtIndex(items, 1)).toEqual([
      { type: 'text', name: 'a', content: '1' },
      { type: 'text', name: 'c', content: '3' },
    ]);
  });
});

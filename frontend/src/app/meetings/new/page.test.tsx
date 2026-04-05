import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NewMeetingPage from './page';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
}));

vi.mock('@/lib/api', () => ({
  addContextFile: vi.fn(),
  addContextText: vi.fn(),
  cleanupStaleDrafts: vi.fn(),
  createMeeting: vi.fn(),
  deleteContextItem: vi.fn(),
  getModels: vi.fn(),
  startMeeting: vi.fn(),
  updateMeeting: vi.fn(),
}));

import { cleanupStaleDrafts, createMeeting, getModels, startMeeting, updateMeeting } from '@/lib/api';

const mockedGetModels = vi.mocked(getModels);
const mockedCreateMeeting = vi.mocked(createMeeting);
const mockedUpdateMeeting = vi.mocked(updateMeeting);
const mockedStartMeeting = vi.mocked(startMeeting);
const mockedCleanupStaleDrafts = vi.mocked(cleanupStaleDrafts);

describe('NewMeetingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockedGetModels.mockResolvedValue({
      copilot_models: [{ id: 'gpt-4o-mini', provider: 'openai', display_name: 'GPT-4o Mini' }],
      summarizer_models: [{ id: 'google/gemini-2.5-pro', provider: 'openrouter', display_name: 'Gemini 2.5 Pro' }],
    });

    mockedCreateMeeting.mockResolvedValue({ session_id: 'session-123' });
    mockedUpdateMeeting.mockResolvedValue({ ok: true });
    mockedStartMeeting.mockResolvedValue({ session_id: 'session-123' });
    mockedCleanupStaleDrafts.mockResolvedValue({ deleted: 0, max_age_minutes: 180 });
  });

  it('does not create a draft on initial page load', async () => {
    render(<NewMeetingPage />);

    await waitFor(() => expect(mockedGetModels).toHaveBeenCalledTimes(1));
    expect(mockedCreateMeeting).not.toHaveBeenCalled();
  });

  it('creates draft lazily when starting a meeting', async () => {
    render(<NewMeetingPage />);

    await waitFor(() => expect(mockedGetModels).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /start meeting/i }));

    await waitFor(() => expect(mockedCreateMeeting).toHaveBeenCalledTimes(1));
    expect(mockedUpdateMeeting).toHaveBeenCalledWith('session-123', {
      title: 'Meeting session-',
      copilot_model_id: 'gpt-4o-mini',
      summarizer_model_id: 'google/gemini-2.5-pro',
    });
    expect(mockedStartMeeting).toHaveBeenCalledWith('session-123');
    expect(pushMock).toHaveBeenCalledWith('/meetings/session-123');
  });
});

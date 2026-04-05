import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
});

export type ModelOption = {
  id: string;
  provider: string;
  display_name: string;
};

export type ModelsResponse = {
  copilot_models: ModelOption[];
  summarizer_models: ModelOption[];
};

export type ContextItem = {
  type: 'text' | 'file';
  name: string;
  content: string;
};

export type MeetingListItem = {
  id: string;
  title: string;
  created_at: string;
  is_active: boolean;
  copilot_model_id: string | null;
  summarizer_model_id: string | null;
};

export type MeetingDetail = MeetingListItem & {
  summary_markdown: string | null;
  transcript: string;
  context_items: ContextItem[];
};

export type ChatResponse = {
  response: string;
  transcription_ok?: boolean;
  transcription_error?: string | null;
};

export type SummarizeResponse = {
  summary_markdown: string;
};

export type SummaryVersion = {
  version: number;
  created_at: string;
  instruction: string | null;
  content: string;
  is_active: boolean;
};

export type CreateMeetingRequest = {
  title?: string;
  copilot_model_id?: string;
  summarizer_model_id?: string;
};

export type UpdateMeetingRequest = {
  title?: string;
  copilot_model_id?: string;
  summarizer_model_id?: string;
};

export const getModels = async (): Promise<ModelsResponse> => {
  const response = await api.get<ModelsResponse>('/models');
  return response.data;
};

export const createMeeting = async (opts: CreateMeetingRequest): Promise<{ session_id: string }> => {
  const response = await api.post<{ session_id: string }>('/meeting/create', opts);
  return response.data;
};

export const startMeeting = async (sessionId: string): Promise<{ session_id: string }> => {
  const response = await api.post<{ session_id: string }>(`/meeting/${sessionId}/start`);
  return response.data;
};

export const getMeetings = async (): Promise<MeetingListItem[]> => {
  const response = await api.get<MeetingListItem[]>('/meetings');
  return response.data;
};

export const getMeeting = async (id: string): Promise<MeetingDetail> => {
  const response = await api.get<MeetingDetail>(`/meetings/${id}`);
  return response.data;
};

export const updateMeeting = async (id: string, data: UpdateMeetingRequest): Promise<{ ok: boolean }> => {
  const response = await api.patch<{ ok: boolean }>(`/meetings/${id}`, data);
  return response.data;
};

export const deleteMeeting = async (id: string): Promise<{ ok: boolean }> => {
  const response = await api.delete<{ ok: boolean }>(`/meetings/${id}`);
  return response.data;
};

export const reactivateMeeting = async (id: string): Promise<{ ok: boolean; transcript: string }> => {
  const response = await api.post<{ ok: boolean; transcript: string }>(`/meetings/${id}/reactivate`);
  return response.data;
};

export const cleanupStaleDrafts = async (
  maxAgeMinutes = 120,
): Promise<{ deleted: number; max_age_minutes: number }> => {
  const response = await api.post<{ deleted: number; max_age_minutes: number }>(
    `/meeting/cleanup-stale-drafts?max_age_minutes=${maxAgeMinutes}`,
  );
  return response.data;
};

export const addContextText = async (sessionId: string, text: string, name?: string): Promise<{ items: ContextItem[] }> => {
  const response = await api.post<{ items: ContextItem[] }>(`/meeting/${sessionId}/context/text`, { text, name });
  return response.data;
};

export const addContextFile = async (sessionId: string, file: File): Promise<{ items: ContextItem[] }> => {
  const formData = new FormData();
  formData.append('file', file, file.name);
  const response = await api.post<{ items: ContextItem[] }>(`/meeting/${sessionId}/context/file`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const deleteContextItem = async (sessionId: string, index: number): Promise<{ items: ContextItem[] }> => {
  const response = await api.delete<{ items: ContextItem[] }>(`/meeting/${sessionId}/context/${index}`);
  return response.data;
};

export const getContext = async (sessionId: string): Promise<{ items: ContextItem[] }> => {
  const response = await api.get<{ items: ContextItem[] }>(`/meeting/${sessionId}/context`);
  return response.data;
};

export const sendChatText = async (sessionId: string, message: string): Promise<ChatResponse> => {
  const response = await api.post<ChatResponse>('/chat/text', { session_id: sessionId, message });
  return response.data;
};

const extensionFromMime = (mimeType?: string) => {
  if (!mimeType) return '.webm';
  if (mimeType.includes('webm')) return '.webm';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return '.mp3';
  if (mimeType.includes('mp4')) return '.mp4';
  if (mimeType.includes('ogg')) return '.ogg';
  if (mimeType.includes('wav')) return '.wav';
  return '.webm';
};

export const sendChatAudio = async (sessionId: string, audioBlob: Blob, mimeType?: string): Promise<ChatResponse> => {
  const effectiveMime = mimeType || audioBlob.type || 'audio/webm';
  const fileExt = extensionFromMime(effectiveMime);

  const formData = new FormData();
  formData.append('session_id', sessionId);
  formData.append('mime_type', effectiveMime);
  formData.append('file_ext', fileExt);
  formData.append('file', audioBlob, `audio${fileExt}`);
  const response = await api.post<ChatResponse>('/chat/audio', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const sendBackgroundTranscript = async (
  sessionId: string,
  audioBlob: Blob,
  mimeType?: string,
): Promise<ChatResponse> => {
  const effectiveMime = mimeType || audioBlob.type || 'audio/webm';
  const fileExt = extensionFromMime(effectiveMime);

  const formData = new FormData();
  formData.append('session_id', sessionId);
  formData.append('mime_type', effectiveMime);
  formData.append('file_ext', fileExt);
  formData.append('file', audioBlob, `audio${fileExt}`);
  const response = await api.post<ChatResponse>('/meeting/transcript', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const summarizeMeeting = async (sessionId: string): Promise<SummarizeResponse> => {
  const response = await api.post<SummarizeResponse>(`/meeting/summarize?session_id=${sessionId}`);
  return response.data;
};

export const regenerateSummary = async (
  sessionId: string,
  instruction?: string,
): Promise<SummarizeResponse> => {
  const response = await api.post<SummarizeResponse>(`/meeting/${sessionId}/summaries/regenerate`, {
    instruction,
  });
  return response.data;
};

export const getSummaryVersions = async (sessionId: string): Promise<{ versions: SummaryVersion[] }> => {
  const response = await api.get<{ versions: SummaryVersion[] }>(`/meetings/${sessionId}/summaries`);
  return response.data;
};

export const activateSummaryVersion = async (sessionId: string, versionNumber: number): Promise<{ ok: boolean }> => {
  const response = await api.post<{ ok: boolean }>(`/meetings/${sessionId}/summaries/${versionNumber}/activate`);
  return response.data;
};

export default api;

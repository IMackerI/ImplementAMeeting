import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
});

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------
export const getModels = async () => {
  const response = await api.get('/models');
  return response.data as {
    copilot_models: { id: string; provider: string; display_name: string }[];
    summarizer_models: { id: string; provider: string; display_name: string }[];
  };
};

// ---------------------------------------------------------------------------
// Meeting lifecycle
// ---------------------------------------------------------------------------
export const createMeeting = async (opts: {
  title?: string;
  copilot_model_id?: string;
  summarizer_model_id?: string;
}) => {
  const response = await api.post('/meeting/create', opts);
  return response.data as { session_id: string };
};

export const startMeeting = async (sessionId: string) => {
  const response = await api.post(`/meeting/${sessionId}/start`);
  return response.data as { session_id: string };
};

export const getMeetings = async () => {
  const response = await api.get('/meetings');
  return response.data;
};

export const getMeeting = async (id: string) => {
  const response = await api.get(`/meetings/${id}`);
  return response.data;
};

export const updateMeeting = async (
  id: string,
  data: { title?: string; copilot_model_id?: string; summarizer_model_id?: string }
) => {
  const response = await api.patch(`/meetings/${id}`, data);
  return response.data;
};

export const deleteMeeting = async (id: string) => {
  const response = await api.delete(`/meetings/${id}`);
  return response.data;
};

export const reactivateMeeting = async (id: string) => {
  const response = await api.post(`/meetings/${id}/reactivate`);
  return response.data as { ok: boolean; transcript: string };
};

// ---------------------------------------------------------------------------
// Context management
// ---------------------------------------------------------------------------
export const addContextText = async (sessionId: string, text: string, name?: string) => {
  const response = await api.post(`/meeting/${sessionId}/context/text`, { text, name });
  return response.data as { items: any[] };
};

export const addContextFile = async (sessionId: string, file: File) => {
  const formData = new FormData();
  formData.append('file', file, file.name);
  const response = await api.post(`/meeting/${sessionId}/context/file`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data as { items: any[] };
};

export const deleteContextItem = async (sessionId: string, index: number) => {
  const response = await api.delete(`/meeting/${sessionId}/context/${index}`);
  return response.data as { items: any[] };
};

export const getContext = async (sessionId: string) => {
  const response = await api.get(`/meeting/${sessionId}/context`);
  return response.data as { items: any[] };
};

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
export const sendChatText = async (sessionId: string, message: string) => {
  const response = await api.post('/chat/text', { session_id: sessionId, message });
  return response.data;
};

export const sendChatAudio = async (sessionId: string, audioBlob: Blob) => {
  const formData = new FormData();
  formData.append('session_id', sessionId);
  formData.append('file', audioBlob, 'audio.webm');
  const response = await api.post('/chat/audio', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const sendBackgroundTranscript = async (sessionId: string, audioBlob: Blob) => {
  const formData = new FormData();
  formData.append('session_id', sessionId);
  formData.append('file', audioBlob, 'audio.webm');
  const response = await api.post('/meeting/transcript', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const summarizeMeeting = async (sessionId: string) => {
  const response = await api.post(`/meeting/summarize?session_id=${sessionId}`);
  return response.data;
};

export default api;

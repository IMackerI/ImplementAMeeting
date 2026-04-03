import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
});

export const startMeeting = async () => {
  const response = await api.post('/meeting/start');
  return response.data;
};

export const getMeetings = async () => {
  const response = await api.get('/meetings');
  return response.data;
};

export const getMeeting = async (id: string) => {
  const response = await api.get(`/meetings/${id}`);
  return response.data;
};

export const sendChatText = async (sessionId: string, message: string) => {
  const response = await api.post('/chat/text', { session_id: sessionId, message });
  return response.data;
};

export const sendChatAudio = async (sessionId: string, audioBlob: Blob) => {
  const formData = new FormData();
  formData.append('session_id', sessionId);
  formData.append('file', audioBlob, 'audio.webm');
  const response = await api.post('/chat/audio', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

export const sendBackgroundTranscript = async (sessionId: string, audioBlob: Blob) => {
  const formData = new FormData();
  formData.append('session_id', sessionId);
  formData.append('file', audioBlob, 'audio.webm');
  const response = await api.post('/meeting/transcript', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};


export const summarizeMeeting = async (sessionId: string) => {
  const response = await api.post(`/meeting/summarize?session_id=${sessionId}`);
  return response.data;
};

export default api;

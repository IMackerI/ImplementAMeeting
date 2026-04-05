'use client';

import React, { useEffect, useState, useRef, use, useCallback } from 'react';
import {
  activateSummaryVersion,
  addContextFile,
  addContextText,
  deleteContextItem,
  getMeeting,
  getSummaryVersions,
  reactivateMeeting,
  regenerateSummary,
  sendBackgroundTranscript,
  sendChatAudio,
  sendChatText,
  summarizeMeeting,
  type SummaryVersion,
  type ToolCallEvent,
  updateMeeting,
} from '@/lib/api';
import { useRouter } from 'next/navigation';
import {
  Mic, MicOff, Send,
  FileText, Activity, Search, CheckCircle2,
  Home, ChevronRight, X,
  Upload, Plus, File as FileIcon, PanelRightOpen,
  RotateCcw, Pencil, Check, Copy, Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown, { type Components } from 'react-markdown';
import { nextViewedSummary, shouldAutoSwitchToSummary } from '@/lib/meetingSessionState';

type ContextItem = { type: 'text' | 'file'; name: string; content: string };
type MeetingData = {
  id: string;
  title: string;
  created_at: string;
  is_active: boolean;
  summary_markdown: string | null;
  transcript: string;
  context_items: ContextItem[];
  copilot_model_id: string | null;
  summarizer_model_id: string | null;
};
type ChatMessage = { role: 'user' | 'assistant'; text: string; tool_calls?: ToolCallEvent[] };

const chatMarkdownComponents: Components = {
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-300 underline underline-offset-2 decoration-blue-400/60 hover:text-blue-200 break-all"
      {...props}
    >
      {children}
    </a>
  ),
};

const getToolCallSummary = (toolCall: ToolCallEvent) => {
  const toolName = toolCall?.tool_name || 'tool';
  const args = toolCall?.tool_args;

  if (args && typeof args === 'object') {
    const query = args.query || args.keywords || args.text || args.prompt;
    if (query) return `${toolName}: ${String(query)}`;
    return `${toolName}: ${JSON.stringify(args)}`;
  }

  if (typeof args === 'string' && args.trim()) {
    return `${toolName}: ${args}`;
  }

  return toolName;
};

export default function MeetingSession({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [meeting, setMeeting] = useState<MeetingData | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasLoadedChatMessages, setHasLoadedChatMessages] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [isBackgroundRecording, setIsBackgroundRecording] = useState(false);
  const [viewedSummary, setViewedSummary] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [summaryVersions, setSummaryVersions] = useState<SummaryVersion[]>([]);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);

  // Inline rename
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Context panel
  const [showContextPanel, setShowContextPanel] = useState(false);
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [textNote, setTextNote] = useState('');
  const [textNoteName, setTextNoteName] = useState('');
  const [showTextNote, setShowTextNote] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const backgroundRecorderRef = useRef<MediaRecorder | null>(null);
  const bgNextChunkTimerRef = useRef<NodeJS.Timeout | null>(null);
  const bgStopChunkTimerRef = useRef<NodeJS.Timeout | null>(null);
  const bgStreamRef = useRef<MediaStream | null>(null);
  const bgLoopActiveRef = useRef(false);
  const bgUploadInFlightRef = useRef(false);
  const isPttActiveRef = useRef(false);

  const isMeetingActiveRef = useRef(false);
  const isMutedRef = useRef(false);
  const suppressBgChunkRef = useRef(false);
  const userChoseTranscriptRef = useRef(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const loadedChatStorageKeyRef = useRef<string>('');

  const micMutedStorageKey = `meeting:${id}:mic-muted`;
  const chatMessagesStorageKey = `meeting:${id}:chat-messages`;

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------
  const fetchSummaryHistory = useCallback(async () => {
    try {
      const { versions } = await getSummaryVersions(id);
      setSummaryVersions(versions);
    } catch (error) {
      console.error('Error fetching summary versions:', error);
    }
  }, [id]);

  const fetchMeeting = useCallback(async () => {
    try {
      const data = await getMeeting(id);
      setMeeting(data);
      isMeetingActiveRef.current = data.is_active;
      if (data.context_items) setContextItems(data.context_items);

      if (!data.is_active && pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }

      if (
        shouldAutoSwitchToSummary({
          hasSummary: Boolean(data.summary_markdown),
          viewedSummary,
          userChoseTranscript: userChoseTranscriptRef.current,
        })
      ) {
        setViewedSummary(true);
      }

      if (data.summary_markdown) {
        fetchSummaryHistory();
      } else {
        setSummaryVersions([]);
      }
    } catch (error) {
      console.error('Error fetching meeting:', error);
    }
  }, [fetchSummaryHistory, id, viewedSummary]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [meeting?.transcript]);
  useEffect(() => { if (isEditingTitle && titleInputRef.current) titleInputRef.current.focus(); }, [isEditingTitle]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(micMutedStorageKey) === '1';
      setIsMuted(stored);
      isMutedRef.current = stored;
    } catch {
      setIsMuted(false);
      isMutedRef.current = false;
    }
  }, [micMutedStorageKey]);

  useEffect(() => {
    setHasLoadedChatMessages(false);
    loadedChatStorageKeyRef.current = '';

    try {
      const raw = window.localStorage.getItem(chatMessagesStorageKey);
      if (!raw) {
        setMessages([]);
      } else {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const restored: ChatMessage[] = parsed
            .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.text === 'string')
            .map((item) => ({
              role: item.role,
              text: item.text,
              tool_calls: Array.isArray(item.tool_calls) ? item.tool_calls : undefined,
            }));
          setMessages(restored);
        } else {
          setMessages([]);
        }
      }
    } catch {
      setMessages([]);
    } finally {
      loadedChatStorageKeyRef.current = chatMessagesStorageKey;
      setHasLoadedChatMessages(true);
    }
  }, [chatMessagesStorageKey]);

  useEffect(() => {
    if (!hasLoadedChatMessages || loadedChatStorageKeyRef.current !== chatMessagesStorageKey) return;
    try {
      const trimmed = messages.slice(-120);
      window.localStorage.setItem(chatMessagesStorageKey, JSON.stringify(trimmed));
    } catch {
      // ignore storage issues
    }
  }, [chatMessagesStorageKey, hasLoadedChatMessages, messages]);

  // ---------------------------------------------------------------------------
  // Recording helpers (background + PTT)
  // ---------------------------------------------------------------------------
  const pickRecorderMimeType = useCallback(() => {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
      'audio/ogg',
    ];
    return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  }, []);

  const clearBackgroundTimers = useCallback(() => {
    if (bgNextChunkTimerRef.current) {
      clearTimeout(bgNextChunkTimerRef.current);
      bgNextChunkTimerRef.current = null;
    }
    if (bgStopChunkTimerRef.current) {
      clearTimeout(bgStopChunkTimerRef.current);
      bgStopChunkTimerRef.current = null;
    }
  }, []);

  const releaseBackgroundStream = useCallback(() => {
    bgStreamRef.current?.getTracks().forEach((track) => track.stop());
    bgStreamRef.current = null;
  }, []);

  const stopBackgroundLoop = useCallback((discardCurrentChunk = false, releaseStream = false) => {
    bgLoopActiveRef.current = false;
    setIsBackgroundRecording(false);
    clearBackgroundTimers();

    if (discardCurrentChunk) {
      suppressBgChunkRef.current = true;
    }

    const recorder = backgroundRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
    }
    backgroundRecorderRef.current = null;

    if (releaseStream) {
      releaseBackgroundStream();
    }
  }, [clearBackgroundTimers, releaseBackgroundStream]);

  const startBackgroundRecording = useCallback(async () => {
    if (!isMeetingActiveRef.current || isMutedRef.current || isPttActiveRef.current || bgLoopActiveRef.current) {
      return;
    }

    try {
      if (!bgStreamRef.current) {
        bgStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      const stream = bgStreamRef.current;
      if (!stream) {
        setIsBackgroundRecording(false);
        return;
      }

      setMicError(null);
      bgLoopActiveRef.current = true;
      setIsBackgroundRecording(true);

      const recordChunk = () => {
        if (!bgLoopActiveRef.current) return;

        if (!isMeetingActiveRef.current) {
          stopBackgroundLoop(true, true);
          return;
        }

        if (isMutedRef.current || isPttActiveRef.current) {
          clearBackgroundTimers();
          bgNextChunkTimerRef.current = setTimeout(recordChunk, 350);
          return;
        }

        const preferredMimeType = pickRecorderMimeType();
        const recorder = preferredMimeType
          ? new MediaRecorder(stream, { mimeType: preferredMimeType })
          : new MediaRecorder(stream);

        backgroundRecorderRef.current = recorder;
        const currentChunks: Blob[] = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            currentChunks.push(e.data);
          }
        };

        recorder.onstop = async () => {
          backgroundRecorderRef.current = null;

          const shouldSend = !suppressBgChunkRef.current;
          suppressBgChunkRef.current = false;

          const finalMimeType = preferredMimeType || recorder.mimeType || 'audio/webm';
          const blob = new Blob(currentChunks, { type: finalMimeType });

          const shouldUpload =
            shouldSend &&
            blob.size > 1024 &&
            isMeetingActiveRef.current &&
            !isMutedRef.current &&
            !isPttActiveRef.current;

          if (shouldUpload && !bgUploadInFlightRef.current) {
            bgUploadInFlightRef.current = true;
            try {
              await sendBackgroundTranscript(id, blob, finalMimeType);
              await fetchMeeting();
            } catch (err) {
              console.error('Background transcription upload error:', err);
            } finally {
              bgUploadInFlightRef.current = false;
            }
          }

          if (bgLoopActiveRef.current && isMeetingActiveRef.current) {
            clearBackgroundTimers();
            bgNextChunkTimerRef.current = setTimeout(recordChunk, 120);
          }
        };

        recorder.start();
        clearBackgroundTimers();
        bgStopChunkTimerRef.current = setTimeout(() => {
          if (recorder.state === 'recording') {
            recorder.stop();
          }
        }, 20000);
      };

      recordChunk();
    } catch (err) {
      console.error('Failed to start background recording:', err);
      setMicError('Microphone unavailable or blocked.');
      bgLoopActiveRef.current = false;
      setIsBackgroundRecording(false);
    }
  }, [clearBackgroundTimers, fetchMeeting, id, pickRecorderMimeType, stopBackgroundLoop]);

  const handleMuteToggle = useCallback(() => {
    const nowMuted = !isMutedRef.current;
    setIsMuted(nowMuted);
    isMutedRef.current = nowMuted;

    try {
      window.localStorage.setItem(micMutedStorageKey, nowMuted ? '1' : '0');
    } catch {
      // ignore storage issues
    }

    if (nowMuted) {
      stopBackgroundLoop(true, true);
      return;
    }

    if (meeting?.is_active) {
      startBackgroundRecording();
    }
  }, [meeting?.is_active, micMutedStorageKey, startBackgroundRecording, stopBackgroundLoop]);

  // ---------------------------------------------------------------------------
  // PTT recording
  // ---------------------------------------------------------------------------
  const startRecording = async () => {
    if (!meeting?.is_active || isMutedRef.current || isRecording || isProcessing) return;

    try {
      isPttActiveRef.current = true;
      stopBackgroundLoop(true, false);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicError(null);
      const preferredMimeType = pickRecorderMimeType();
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;

        const finalMimeType = preferredMimeType || recorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: finalMimeType });

        isPttActiveRef.current = false;

        if (audioBlob.size < 1024) {
          if (isMeetingActiveRef.current && !isMutedRef.current) {
            startBackgroundRecording();
          }
          return;
        }

        setIsProcessing(true);
        try {
          const response = await sendChatAudio(id, audioBlob, finalMimeType);
          if (response.response) {
            setMessages((prev) => [...prev, { role: 'assistant', text: response.response, tool_calls: response.tool_calls }]);
          }
          if (response.transcription_error) {
            console.warn('PTT transcription warning:', response.transcription_error);
          }
          await fetchMeeting();
        } catch (err) {
          console.error('Audio transcription error:', err);
        } finally {
          setIsProcessing(false);
          if (isMeetingActiveRef.current && !isMutedRef.current) {
            startBackgroundRecording();
          }
        }
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      isPttActiveRef.current = false;
      setMicError('Microphone unavailable or blocked.');
      console.error('Failed to start recording:', err);
      if (isMeetingActiveRef.current && !isMutedRef.current) {
        startBackgroundRecording();
      }
    }
  };

  const stopRecording = () => {
    if (!isRecording) return;

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
    }
    setIsRecording(false);
  };

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) return;
      if (!isMeetingActiveRef.current || isMutedRef.current) return;

      setIsMuted(true);
      isMutedRef.current = true;

      try {
        window.localStorage.setItem(micMutedStorageKey, '1');
      } catch {
        // ignore storage issues
      }

      stopBackgroundLoop(true, true);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [micMutedStorageKey, stopBackgroundLoop]);

  useEffect(() => {
    fetchMeeting().then(() => {
      if (isMeetingActiveRef.current && !isMutedRef.current) {
        startBackgroundRecording();
      }
    });
    pollIntervalRef.current = setInterval(fetchMeeting, 5000);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      isMeetingActiveRef.current = false;

      const pttRecorder = mediaRecorderRef.current;
      if (pttRecorder && pttRecorder.state === 'recording') {
        pttRecorder.stop();
      }

      stopBackgroundLoop(true, true);
    };
  }, [fetchMeeting, id, startBackgroundRecording, stopBackgroundLoop]);

  // ---------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------
  const handleSendText = async () => {
    if (!meeting?.is_active || !inputText.trim()) return;
    const msg = inputText;
    setInputText('');
    setMessages(prev => [...prev, { role: 'user', text: msg }]);
    setIsProcessing(true);
    try {
      const response = await sendChatText(id, msg);
      setMessages(prev => [...prev, { role: 'assistant', text: response.response, tool_calls: response.tool_calls }]);
      fetchMeeting();
    } catch (err) {
      console.error('Text chat error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Meeting actions
  // ---------------------------------------------------------------------------
  const handleEndMeeting = async () => {
    setIsProcessing(true);
    try {
      await summarizeMeeting(id);
      fetchMeeting();
    } catch (err) {
      console.error('Error ending meeting:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleContinueMeeting = async () => {
    setIsProcessing(true);
    try {
      await reactivateMeeting(id);
      setViewedSummary(false);
      userChoseTranscriptRef.current = false;
      isMeetingActiveRef.current = true;
      stopBackgroundLoop(true, false);
      await fetchMeeting();
      // Restart polling and recording
      if (!pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(fetchMeeting, 5000);
      }
      if (!isMutedRef.current) {
        startBackgroundRecording();
      }
    } catch (err) {
      console.error('Error continuing meeting:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRegenerateSummary = async () => {
    const instruction = window.prompt('Optional: add guidance for this regenerated plan (scope, detail level, format).') ?? '';

    setIsRegenerating(true);
    setIsProcessing(true);
    try {
      await regenerateSummary(id, instruction.trim() || undefined);
      await fetchMeeting();
      await fetchSummaryHistory();
      setViewedSummary(true);
      userChoseTranscriptRef.current = false;
    } catch (err) {
      console.error('Summary regeneration error:', err);
    } finally {
      setIsRegenerating(false);
      setIsProcessing(false);
    }
  };

  const handleActivateSummaryVersion = async (versionNumber: number) => {
    try {
      await activateSummaryVersion(id, versionNumber);
      await fetchMeeting();
      await fetchSummaryHistory();
      setViewedSummary(true);
      userChoseTranscriptRef.current = false;
    } catch (err) {
      console.error('Failed to activate summary version:', err);
    }
  };

  const handleCopySummary = async () => {
    const summary = meeting?.summary_markdown;
    if (!summary) return;

    try {
      await navigator.clipboard.writeText(summary);
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 1500);
    } catch (err) {
      console.error('Copy summary failed:', err);
    }
  };

  const handleDownloadSummary = () => {
    const summary = meeting?.summary_markdown;
    if (!summary) return;

    const blob = new Blob([summary], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeTitle = (meeting?.title || 'meeting-summary').replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    a.href = url;
    a.download = `${safeTitle || 'meeting-summary'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSaveTitle = async () => {
    const newTitle = editTitle.trim();
    if (newTitle && newTitle !== meeting?.title) {
      try {
        await updateMeeting(id, { title: newTitle });
        setMeeting((prev) => (prev ? { ...prev, title: newTitle } : prev));
      } catch (e) {
        console.error('Rename error:', e);
      }
    }
    setIsEditingTitle(false);
  };

  // ---------------------------------------------------------------------------
  // Context during meeting
  // ---------------------------------------------------------------------------
  const handleContextFileUpload = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      try {
        const { items } = await addContextFile(id, file);
        setContextItems(items);
      } catch (e) {
        console.error('Context file upload error:', e);
      }
    }
  };

  const handleAddTextNote = async () => {
    if (!textNote.trim()) return;
    try {
      const { items } = await addContextText(id, textNote, textNoteName || 'Text note');
      setContextItems(items);
      setTextNote('');
      setTextNoteName('');
      setShowTextNote(false);
    } catch (e) {
      console.error('Add text note error:', e);
    }
  };

  const handleDeleteContextItem = async (index: number) => {
    try {
      const { items } = await deleteContextItem(id, index);
      setContextItems(items);
    } catch (e) {
      console.error('Delete context error:', e);
    }
  };

  const handleViewTranscript = () => {
    userChoseTranscriptRef.current = true;
    setViewedSummary(nextViewedSummary('transcript'));
  };
  const handleViewSummary = () => {
    userChoseTranscriptRef.current = false;
    setViewedSummary(nextViewedSummary('summary'));
  };

  if (!meeting) return (
    <div className="h-screen bg-black flex items-center justify-center text-zinc-500 font-mono tracking-tighter">
      Initializing Session...
    </div>
  );

  const modelLabel = meeting.copilot_model_id
    ? meeting.copilot_model_id.split('/').pop() ?? meeting.copilot_model_id
    : 'GPT-4o Mini';
  const activeSummaryVersion = summaryVersions.find((version) => version.is_active) ?? summaryVersions[0];

  return (
    <div className="h-screen flex flex-col bg-black text-zinc-100 overflow-hidden font-sans">
      {/* Top Navbar */}
      <nav className="h-16 border-b border-white/5 flex items-center justify-between px-6 shrink-0 bg-black/80 backdrop-blur-xl z-20">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/meetings')} className="p-2 hover:bg-white/5 rounded-xl transition-all hover:scale-105">
            <Home size={20} className="text-zinc-400" />
          </button>
          <div className="h-4 w-px bg-white/10" />

          {/* Inline editable title */}
          {isEditingTitle ? (
            <div className="flex items-center gap-2">
              <input
                ref={titleInputRef}
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') setIsEditingTitle(false); }}
                onBlur={handleSaveTitle}
                className="bg-zinc-900 border border-blue-500/50 rounded-lg px-3 py-1 text-lg font-bold outline-none focus:ring-2 focus:ring-blue-500/30 min-w-0 w-48"
              />
              <button onClick={handleSaveTitle} className="p-1 hover:bg-white/5 rounded-lg text-blue-400">
                <Check size={16} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setEditTitle(meeting.title); setIsEditingTitle(true); }}
              className="flex items-center gap-2 group"
              title="Click to rename"
            >
              <h2 className="font-bold text-lg tracking-tight group-hover:text-blue-400 transition-colors">{meeting.title}</h2>
              <Pencil size={14} className="text-zinc-700 group-hover:text-zinc-400 transition-colors" />
            </button>
          )}

          {meeting.is_active ? (
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full border shadow-lg ${isMuted ? 'bg-amber-500/10 border-amber-500/20' : micError ? 'bg-red-500/10 border-red-500/20' : isBackgroundRecording || isRecording ? 'bg-blue-500/10 border-blue-500/20 shadow-blue-500/5' : 'bg-zinc-800/50 border-white/10'}`}>
              <span className={`h-2 w-2 rounded-full ${isMuted ? 'bg-amber-500' : micError ? 'bg-red-500' : isBackgroundRecording || isRecording ? 'bg-blue-500 animate-pulse' : 'bg-zinc-500'}`} />
              <span className={`text-[10px] font-black uppercase tracking-widest ${isMuted ? 'text-amber-500' : micError ? 'text-red-400' : isBackgroundRecording || isRecording ? 'text-blue-500' : 'text-zinc-400'}`}>
                {isMuted ? 'Muted' : micError ? 'Mic blocked' : isBackgroundRecording || isRecording ? 'Listening' : 'Idle'}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-zinc-800/50 px-3 py-1 rounded-full border border-white/10 text-zinc-400">
              <CheckCircle2 size={12} className="text-zinc-500" />
              <span className="text-[10px] font-black uppercase tracking-widest">Archived</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-6 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
            <div className="flex flex-col">
              <span className="text-zinc-700">Copilot</span>
              <span className="text-blue-400">{modelLabel}</span>
            </div>
          </div>

          {/* Context panel toggle */}
          <button
            onClick={() => setShowContextPanel(v => !v)}
            className={`p-2 rounded-xl transition-all ${showContextPanel ? 'bg-purple-500/20 text-purple-400' : 'hover:bg-white/5 text-zinc-500 hover:text-zinc-300'}`}
            title="Context materials"
          >
            <PanelRightOpen size={20} />
          </button>

        </div>
      </nav>

      <main className="flex-1 flex overflow-hidden relative">
        {/* Main Content Area: Summary OR Transcript */}
        <section className="relative flex-1 flex flex-col min-w-0 bg-[#050505]">
          <div className="p-6 border-b border-white/5 flex justify-between items-center bg-black/40 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${viewedSummary ? 'bg-blue-500' : 'bg-zinc-800'}`}>
                <FileText size={18} className={viewedSummary ? 'text-white' : 'text-blue-400'} />
              </div>
              <div>
                <span className="text-zinc-400 font-bold text-sm tracking-tight">
                  {viewedSummary ? 'Implementation Plan' : 'Live Session Transcript'}
                </span>
                <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">
                  {viewedSummary ? 'AI Generated Summary' : 'Real-time Audio Stream'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {viewedSummary ? (
                <>
                  <button
                    onClick={handleViewTranscript}
                    className="text-xs font-bold text-zinc-500 hover:text-zinc-300 transition-colors uppercase tracking-widest flex items-center gap-2"
                  >
                    <FileText size={14} />
                    View Transcript
                  </button>

                  {meeting.summary_markdown && (
                    <>
                      <button
                        onClick={handleRegenerateSummary}
                        disabled={isRegenerating || isProcessing}
                        className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-zinc-300 border border-white/10 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-50"
                        title="Generate a new plan version"
                      >
                        <RotateCcw size={14} />
                        Regenerate
                      </button>

                      <button
                        onClick={handleCopySummary}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest border border-white/10 text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors"
                        title="Copy markdown"
                      >
                        <Copy size={13} />
                        {copiedSummary ? 'Copied' : 'Copy'}
                      </button>

                      <button
                        onClick={handleDownloadSummary}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-widest border border-white/10 text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors"
                        title="Download markdown"
                      >
                        <Download size={13} />
                        Download
                      </button>

                      {summaryVersions.length > 0 && (
                        <select
                          value={activeSummaryVersion?.version ?? ''}
                          onChange={(e) => handleActivateSummaryVersion(Number(e.target.value))}
                          className="bg-zinc-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-zinc-300 font-bold uppercase tracking-widest outline-none focus:ring-2 focus:ring-blue-500/30"
                          title="Switch summary version"
                        >
                          {summaryVersions.map((version) => (
                            <option key={version.version} value={version.version}>
                              V{version.version}{version.instruction ? ' • custom' : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </>
                  )}

                  {!meeting.is_active && (
                    <button
                      onClick={handleContinueMeeting}
                      disabled={isProcessing}
                      className="flex items-center gap-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-50"
                    >
                      <RotateCcw size={14} />
                      Continue Meeting
                    </button>
                  )}
                </>
              ) : (
                meeting.summary_markdown && (
                  <button
                    onClick={handleViewSummary}
                    className="text-xs font-bold text-zinc-500 hover:text-zinc-300 transition-colors uppercase tracking-widest flex items-center gap-2"
                  >
                    <FileText size={14} />
                    View Summary
                  </button>
                )
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-12 pb-36 space-y-8 scroll-smooth selection:bg-blue-500/30">
            {viewedSummary && meeting.summary_markdown ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-4xl mx-auto space-y-4"
              >
                {activeSummaryVersion && (
                  <div className="text-xs text-zinc-500 uppercase tracking-widest font-bold">
                    Viewing version V{activeSummaryVersion.version}
                    {activeSummaryVersion.instruction ? ' • custom instruction' : ''}
                  </div>
                )}
                <div className="prose prose-invert prose-blue max-w-none prose-h1:text-4xl prose-h1:font-black prose-h2:text-2xl prose-h2:mt-12 prose-p:text-zinc-400 prose-p:leading-relaxed prose-p:text-lg prose-li:text-zinc-400">
                  <ReactMarkdown>{meeting.summary_markdown}</ReactMarkdown>
                </div>
              </motion.div>
            ) : (
              <div className="max-w-4xl mx-auto space-y-6">
                <div className="prose prose-invert max-w-none prose-p:text-zinc-400 prose-strong:text-blue-400 prose-p:leading-relaxed prose-p:text-lg">
                  <ReactMarkdown>{meeting.transcript || '*Awaiting session audio...*'}</ReactMarkdown>
                </div>
                <div ref={transcriptEndRef} />
              </div>
            )}
          </div>

          {meeting.is_active && (
            <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-6">
              <div className="pointer-events-auto inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/80 backdrop-blur-md p-2 shadow-2xl">
                <button
                  onClick={handleMuteToggle}
                  className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border text-xs font-black uppercase tracking-widest transition-all ${isMuted ? 'bg-amber-500/20 border-amber-400/30 text-amber-300 hover:bg-amber-500/30' : 'bg-zinc-900 border-white/10 text-zinc-300 hover:bg-zinc-800 hover:text-white'}`}
                  title={isMuted ? 'Microphone is muted' : 'Microphone is live'}
                >
                  {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
                  <span>{isMuted ? 'Mic Muted' : 'Mic Live'}</span>
                </button>

                <button
                  onClick={handleEndMeeting}
                  className="inline-flex items-center justify-center gap-2 bg-zinc-100 text-black px-4 py-2 rounded-xl text-xs font-black hover:bg-white transition-all disabled:opacity-50 uppercase tracking-widest"
                  disabled={isProcessing}
                >
                  Finish & Summarize
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Context Panel */}
        <AnimatePresence>
          {showContextPanel && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 35 }}
              className="flex flex-col shrink-0 bg-zinc-950 border-l border-white/5 overflow-hidden"
            >
              <div className="w-[320px] flex flex-col h-full">
                <div className="p-4 border-b border-white/5 flex justify-between items-center">
                  <span className="text-xs font-black uppercase tracking-widest text-zinc-400">Context Materials</span>
                  <button onClick={() => setShowContextPanel(false)} className="p-1.5 hover:bg-white/5 rounded-lg text-zinc-600 hover:text-zinc-300 transition-colors">
                    <X size={16} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {/* Drop zone */}
                  <div
                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={e => { e.preventDefault(); setIsDragging(false); handleContextFileUpload(e.dataTransfer.files); }}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${isDragging ? 'border-blue-500/60 bg-blue-500/5' : 'border-white/10 hover:border-white/20'}`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      accept=".txt,.md,.pdf,.docx,.csv,.json,.py,.js,.ts,.html,.yaml,.yml"
                      onChange={e => handleContextFileUpload(e.target.files)}
                    />
                    <Upload size={18} className="mx-auto mb-1 text-zinc-600" />
                    <p className="text-xs text-zinc-500">Drop or <span className="text-blue-400">browse</span> files</p>
                  </div>

                  <button
                    onClick={() => setShowTextNote(v => !v)}
                    className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    <Plus size={14} /> Add text note
                  </button>

                  <AnimatePresence>
                    {showTextNote && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="bg-zinc-900 border border-white/10 rounded-xl p-3 space-y-2">
                          <input
                            type="text"
                            value={textNoteName}
                            onChange={e => setTextNoteName(e.target.value)}
                            placeholder="Note title (optional)"
                            className="w-full bg-zinc-800 border border-white/5 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-blue-500/30 placeholder:text-zinc-700"
                          />
                          <textarea
                            value={textNote}
                            onChange={e => setTextNote(e.target.value)}
                            placeholder="Paste context, notes, agenda..."
                            rows={3}
                            className="w-full bg-zinc-800 border border-white/5 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-blue-500/30 placeholder:text-zinc-700 resize-none"
                          />
                          <div className="flex justify-end gap-2">
                            <button onClick={() => { setShowTextNote(false); setTextNote(''); }} className="px-3 py-1 text-xs text-zinc-500 hover:text-zinc-300">Cancel</button>
                            <button onClick={handleAddTextNote} disabled={!textNote.trim()} className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-bold disabled:opacity-40 transition-all">Add</button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {contextItems.length === 0 ? (
                    <p className="text-xs text-zinc-700 text-center py-4">No context added yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {contextItems.map((item, idx) => (
                        <div key={idx} className="flex items-start gap-2 bg-zinc-900 border border-white/5 rounded-xl p-3">
                          <div className="p-1 bg-zinc-800 rounded-lg shrink-0 mt-0.5">
                            {item.type === 'file' ? <FileIcon size={12} className="text-blue-400" /> : <FileText size={12} className="text-purple-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{item.name}</p>
                            <p className="text-[10px] text-zinc-600">{item.content.length.toLocaleString()} chars</p>
                          </div>
                          <button onClick={() => handleDeleteContextItem(idx)} className="p-1 hover:bg-red-500/10 rounded-lg text-zinc-600 hover:text-red-400 transition-all shrink-0">
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Expand button for collapsed chat */}
        {chatCollapsed && (
          <button
            onClick={() => setChatCollapsed(false)}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-30 p-2 bg-zinc-900 rounded-l-xl border border-white/10 border-r-0 text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all"
            title="Open Co-Pilot"
          >
            <ChevronRight size={20} className="rotate-180" />
          </button>
        )}

        {/* Right Sidebar: Copilot Chat */}
        <motion.section
          initial={false}
          animate={{ width: chatCollapsed ? 0 : 450 }}
          transition={{ type: 'spring', stiffness: 300, damping: 35 }}
          className="relative flex flex-col shrink-0 bg-black border-l border-white/5 overflow-hidden shadow-2xl"
        >
          <div className="flex flex-col h-full w-[450px]">
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-zinc-900/10 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-zinc-900 rounded-xl border border-white/5">
                  <Activity size={20} className={meeting.is_active ? 'text-blue-500' : 'text-zinc-600'} />
                </div>
                <div>
                  <h3 className="font-bold text-sm">Meeting Co-Pilot</h3>
                  <div className="flex items-center gap-2">
                    <div className={`h-1.5 w-1.5 rounded-full ${!meeting.is_active ? 'bg-zinc-700' : isMuted ? 'bg-amber-500' : micError ? 'bg-red-500' : isBackgroundRecording || isRecording ? 'bg-green-500' : 'bg-zinc-500'}`} />
                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                      {!meeting.is_active ? 'Session Ended' : isMuted ? 'Muted' : micError ? 'Mic blocked' : isBackgroundRecording || isRecording ? 'Online' : 'Idle'}
                    </span>
                  </div>
                </div>
              </div>
              <button onClick={() => setChatCollapsed(true)} className="p-2 hover:bg-white/5 rounded-lg text-zinc-600 hover:text-zinc-300 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-zinc-950/20">
              <AnimatePresence initial={false}>
                {messages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-center space-y-4 px-12 mt-20 opacity-50">
                    <div className="p-4 bg-zinc-900/50 rounded-full border border-white/5">
                      <Search size={32} />
                    </div>
                    <p className="text-xs font-medium uppercase tracking-widest">Ask for research, facts, or meeting details</p>
                  </div>
                )}
                {messages.map((m, idx) => {
                  const toolCalls = (m.tool_calls ?? []).filter((tc) => tc?.type === 'call');
                  const hasToolCalls = toolCalls.length > 0;

                  return (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: m.role === 'user' ? 20 : -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[92%] p-4 rounded-2xl ${m.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none shadow-lg shadow-blue-600/10' : 'bg-white/5 border border-white/10 rounded-tl-none text-zinc-100'}`}>
                        {m.role === 'assistant' ? (
                          <div className="space-y-3">
                            {hasToolCalls && (
                              <div className="space-y-2">
                                <p className="text-[10px] uppercase tracking-[0.15em] font-black text-blue-300/80">Actions</p>
                                <div className="space-y-1.5">
                                  {toolCalls.map((tc, tcIdx) => (
                                    <div key={tcIdx} className="flex items-center gap-2 text-[10px] font-black text-blue-200 uppercase tracking-[0.08em] bg-blue-500/10 py-1.5 px-2.5 rounded-lg border border-blue-400/20 w-fit max-w-full">
                                      <Search size={10} className="text-blue-300 shrink-0" />
                                      <span className="truncate">{getToolCallSummary(tc)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className={hasToolCalls ? 'pt-3 border-t border-white/10' : ''}>
                              {hasToolCalls && (
                                <p className="text-[10px] uppercase tracking-[0.15em] font-black text-zinc-500 mb-2">Response</p>
                              )}
                              <div className="prose prose-sm prose-invert max-w-none prose-p:text-zinc-200 prose-headings:text-zinc-100 prose-strong:text-blue-300">
                                <ReactMarkdown components={chatMarkdownComponents}>{m.text}</ReactMarkdown>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="prose prose-sm prose-invert max-w-none prose-p:text-white">
                            <ReactMarkdown components={chatMarkdownComponents}>{m.text}</ReactMarkdown>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
                {isProcessing && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                    <div className="bg-white/5 p-4 rounded-2xl rounded-tl-none border border-white/10">
                      <div className="flex gap-2">
                        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-duration:800ms]" />
                        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-duration:800ms] [animation-delay:200ms]" />
                        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-duration:800ms] [animation-delay:400ms]" />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div ref={chatEndRef} />
            </div>

            {/* Controls */}
            <div className={`p-6 border-t border-white/5 bg-black transition-opacity duration-300 ${!meeting.is_active ? 'opacity-30 grayscale pointer-events-none' : ''}`}>
              <div className="flex flex-col gap-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inputText}
                    disabled={!meeting.is_active}
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSendText()}
                    placeholder="Consult your Co-Pilot..."
                    className="flex-1 bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all text-sm placeholder:text-zinc-700"
                  />
                  <button
                    onClick={handleSendText}
                    disabled={!meeting.is_active}
                    className="bg-blue-600 hover:bg-blue-500 p-3 rounded-xl transition-all shadow-lg shadow-blue-600/30 flex items-center justify-center disabled:opacity-50"
                  >
                    <Send size={18} className="text-white" />
                  </button>
                </div>

                <button
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                  onMouseLeave={isRecording ? stopRecording : undefined}
                  disabled={!meeting.is_active || isMuted}
                  className={`h-20 rounded-2xl flex flex-col items-center justify-center gap-2 transition-all relative overflow-hidden group disabled:opacity-50 disabled:cursor-not-allowed ${isRecording ? 'bg-red-500 shadow-2xl shadow-red-500/30 scale-[0.98]' : isMuted ? 'bg-zinc-900/70 border border-white/5' : 'bg-zinc-900 hover:bg-zinc-900/80 border border-white/5 hover:border-white/10'}`}
                >
                  <div className="z-10 flex flex-col items-center">
                    <Mic size={24} className={isRecording ? 'text-white' : isMuted ? 'text-zinc-700' : 'text-zinc-500 group-hover:text-blue-400 transition-colors'} />
                    <span className={`text-[10px] font-black uppercase tracking-[0.2em] mt-1.5 ${isRecording ? 'text-white' : isMuted ? 'text-zinc-700' : 'text-zinc-600 group-hover:text-zinc-400'}`}>
                      {isRecording ? 'Listening...' : isMuted ? 'Mic Muted' : 'Push to Talk'}
                    </span>
                  </div>
                  {isRecording && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="absolute inset-0 bg-gradient-to-t from-red-600/20 to-transparent"
                    />
                  )}
                </button>
              </div>
            </div>
          </div>
        </motion.section>
      </main>
    </div>
  );
}

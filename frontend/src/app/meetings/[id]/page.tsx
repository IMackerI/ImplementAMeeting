'use client';

import React, { useEffect, useState, useRef, use, useCallback } from 'react';
import { getMeeting, sendChatText, sendChatAudio, sendBackgroundTranscript, summarizeMeeting } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { 
  Mic, Send, 
  FileText, Activity, Search, CheckCircle2,
  Home, ChevronRight, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';

export default function MeetingSession({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  
  const [meeting, setMeeting] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  // viewedSummary: true = showing summary, false = showing transcript
  const [viewedSummary, setViewedSummary] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  const backgroundRecorderRef = useRef<MediaRecorder | null>(null);
  const bgTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const bgStreamRef = useRef<MediaStream | null>(null);     // keep stream alive across chunks
  const isMeetingActiveRef = useRef(true);
  // When true, the background recorder's onstop will discard the chunk instead of sending it
  const suppressBgChunkRef = useRef(false);
  // Tracks whether user manually chose to view transcript (prevents auto-switch back to summary)
  const userChoseTranscriptRef = useRef(false);
  // Keep the polling interval in a ref so we can clear it
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const fetchMeeting = useCallback(async () => {
    try {
      const data = await getMeeting(id);
      setMeeting(data);
      isMeetingActiveRef.current = data.is_active;

      // Stop polling once the meeting is done — no need to keep fetching
      if (!data.is_active && pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }

      // Auto-switch to summary view only if:
      // 1. Summary exists
      // 2. We haven't shown it yet (viewedSummary is still false)
      // 3. The user hasn't manually navigated to the transcript view
      if (data.summary_markdown && !viewedSummary && !userChoseTranscriptRef.current) {
        setViewedSummary(true);
        // NOTE: We intentionally do NOT collapse the chat panel here
      }
    } catch (error) {
      console.error('Error fetching meeting:', error);
    }
  }, [id, viewedSummary]);

  useEffect(() => {
    fetchMeeting();
    pollIntervalRef.current = setInterval(fetchMeeting, 5000); 
    startBackgroundRecording(); 
    
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      isMeetingActiveRef.current = false;
      if (bgTimeoutRef.current) clearTimeout(bgTimeoutRef.current);
      backgroundRecorderRef.current?.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [meeting?.transcript]);

  const startBackgroundRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      bgStreamRef.current = stream;
      
      const recordChunk = () => {
        // Stop the loop if the meeting is over
        if (!isMeetingActiveRef.current) {
           console.log("Meeting ended, stopping background recorder.");
           stream.getTracks().forEach(track => track.stop());
           return;
        }

        const options = { mimeType: 'audio/webm' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) options.mimeType = '';
        
        const recorder = new MediaRecorder(stream, options);
        backgroundRecorderRef.current = recorder;
        const currentChunks: Blob[] = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) currentChunks.push(e.data);
        };

        recorder.onstop = async () => {
          // If PTT was active during this chunk, discard it — we don't want the user's
          // question appearing in the meeting transcript as if it were meeting speech.
          const shouldSend = !suppressBgChunkRef.current;
          suppressBgChunkRef.current = false; // reset for next chunk

          const blob = new Blob(currentChunks, { type: options.mimeType || 'audio/webm' });
          if (shouldSend && blob.size > 100 && isMeetingActiveRef.current) { 
            sendBackgroundTranscript(id, blob).then(() => fetchMeeting());
          }
          // Schedule next chunk only if meeting is still active
          if (isMeetingActiveRef.current) {
            bgTimeoutRef.current = setTimeout(recordChunk, 100);
          } else {
            stream.getTracks().forEach(track => track.stop());
          }
        };

        recorder.start();
        setTimeout(() => {
          if (recorder.state === 'recording') recorder.stop();
        }, 20000);
      };

      recordChunk();
    } catch (err) {
      console.error('Failed to start background recording:', err);
    }
  };

  const startRecording = async () => {
    if (!meeting?.is_active) return;
    try {
      // Pause the background recorder so the user's question doesn't bleed into the transcript.
      // Mark the current bg chunk for suppression and stop it early.
      suppressBgChunkRef.current = true;
      if (bgTimeoutRef.current) {
        clearTimeout(bgTimeoutRef.current);
        bgTimeoutRef.current = null;
      }
      if (backgroundRecorderRef.current?.state === 'recording') {
        backgroundRecorderRef.current.stop(); // onstop will discard due to suppressBgChunkRef
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = { mimeType: 'audio/webm' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) options.mimeType = '';

      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: options.mimeType || 'audio/webm' });
        setIsProcessing(true);
        try {
          const response = await sendChatAudio(id, audioBlob);
          setMessages(prev => [...prev, { role: 'assistant', text: response.response }]);
          fetchMeeting(); 
        } catch (err) {
          console.error('Audio transcription error:', err);
        } finally {
          setIsProcessing(false);
        }
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    // Restart the background recorder now that PTT is done
    if (isMeetingActiveRef.current && bgStreamRef.current) {
      const stream = bgStreamRef.current;
      // Give the PTT onstop a moment to finish before we start recording again
      setTimeout(() => {
        if (!isMeetingActiveRef.current) return;
        const options = { mimeType: 'audio/webm' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) options.mimeType = '';
        const recorder = new MediaRecorder(stream, options);
        backgroundRecorderRef.current = recorder;
        const currentChunks: Blob[] = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) currentChunks.push(e.data); };
        recorder.onstop = async () => {
          const suppress = suppressBgChunkRef.current;
          suppressBgChunkRef.current = false;
          const blob = new Blob(currentChunks, { type: options.mimeType || 'audio/webm' });
          if (!suppress && blob.size > 100 && isMeetingActiveRef.current) {
            sendBackgroundTranscript(id, blob).then(() => fetchMeeting());
          }
          if (isMeetingActiveRef.current) bgTimeoutRef.current = setTimeout(() => startBackgroundRecording(), 100);
        };
        recorder.start();
        setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 20000);
      }, 300);
    }
  };

  const handleSendText = async () => {
    if (!meeting?.is_active || !inputText.trim()) return;
    const msg = inputText;
    setInputText('');
    setMessages(prev => [...prev, { role: 'user', text: msg }]);
    
    setIsProcessing(true);
    try {
      const response = await sendChatText(id, msg);
      setMessages(prev => [...prev, { role: 'assistant', text: response.response }]);
      fetchMeeting();
    } catch (err) {
      console.error('Text chat error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

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

  const handleViewTranscript = () => {
    // Mark that the user explicitly chose the transcript view — prevent auto-switch back
    userChoseTranscriptRef.current = true;
    setViewedSummary(false);
  };

  const handleViewSummary = () => {
    userChoseTranscriptRef.current = false;
    setViewedSummary(true);
  };

  if (!meeting) return <div className="h-screen bg-black flex items-center justify-center text-zinc-500 font-mono tracking-tighter">Initializing Session...</div>;

  return (
    <div className="h-screen flex flex-col bg-black text-zinc-100 overflow-hidden font-sans">
      {/* Top Navbar */}
      <nav className="h-16 border-b border-white/5 flex items-center justify-between px-6 shrink-0 bg-black/80 backdrop-blur-xl z-20">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/meetings')} className="p-2 hover:bg-white/5 rounded-xl transition-all hover:scale-105">
            <Home size={20} className="text-zinc-400" />
          </button>
          <div className="h-4 w-px bg-white/10" />
          <h2 className="font-bold text-lg tracking-tight">{meeting.title}</h2>
          {meeting.is_active ? (
            <div className="flex items-center gap-2 bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20 shadow-lg shadow-blue-500/5">
              <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Listening</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-zinc-800/50 px-3 py-1 rounded-full border border-white/10 text-zinc-400">
              <CheckCircle2 size={12} className="text-zinc-500" />
              <span className="text-[10px] font-black uppercase tracking-widest">Archived</span>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-6">
           <div className="flex items-center gap-6 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
              <div className="flex flex-col">
                <span className="text-zinc-700">Storage</span>
                <span>SQLite DB</span>
              </div>
              <div className="flex flex-col">
                <span className="text-zinc-700">Copilot</span>
                <span className="text-blue-400">GPT-4o Mini</span>
              </div>
           </div>
           {meeting.is_active && (
            <button 
              onClick={handleEndMeeting}
              className="bg-zinc-100 text-black px-5 py-2 rounded-xl text-xs font-black hover:bg-white transition-all hover:shadow-xl hover:shadow-white/10 disabled:opacity-50 uppercase tracking-widest"
              disabled={isProcessing}
            >
              Finish &amp; Summarize
            </button>
          )}
        </div>
      </nav>

      <main className="flex-1 flex overflow-hidden relative">
        {/* Main Content Area: Summary OR Transcript */}
        <section className="flex-1 flex flex-col min-w-0 bg-[#050505]">
          <div className="p-6 border-b border-white/5 flex justify-between items-center bg-black/40 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${viewedSummary ? 'bg-blue-500' : 'bg-zinc-800'}`}>
                <FileText size={18} className={viewedSummary ? "text-white" : "text-blue-400"} />
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
            
            <div className="flex items-center gap-3">
              {/* Toggle between summary and transcript */}
              {viewedSummary ? (
                <button 
                  onClick={handleViewTranscript}
                  className="text-xs font-bold text-zinc-500 hover:text-zinc-300 transition-colors uppercase tracking-widest flex items-center gap-2"
                >
                  <FileText size={14} />
                  View Original Transcript
                </button>
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

          <div className="flex-1 overflow-y-auto p-12 space-y-8 scroll-smooth selection:bg-blue-500/30">
            {viewedSummary && meeting.summary_markdown ? (
                <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="prose prose-invert prose-blue max-w-4xl mx-auto prose-h1:text-4xl prose-h1:font-black prose-h2:text-2xl prose-h2:mt-12 prose-p:text-zinc-400 prose-p:leading-relaxed prose-p:text-lg prose-li:text-zinc-400"
                >
                     <ReactMarkdown>{meeting.summary_markdown}</ReactMarkdown>
                </motion.div>
            ) : (
                <div className="max-w-4xl mx-auto space-y-6">
                    <div className="prose prose-invert max-w-none prose-p:text-zinc-400 prose-strong:text-blue-400 prose-p:leading-relaxed prose-p:text-lg">
                        <ReactMarkdown>{meeting.transcript || "*Awaiting session audio...*"}</ReactMarkdown>
                    </div>
                    <div ref={transcriptEndRef} />
                </div>
            )}
          </div>
        </section>

        {/* 
          Expand button: rendered OUTSIDE the animated motion.section so it is
          never clipped by overflow:hidden when the panel is collapsed.
          It sits absolutely positioned at the right edge of the main area. 
        */}
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
                   <Activity size={20} className={meeting.is_active ? "text-blue-500" : "text-zinc-600"} />
                 </div>
                 <div>
                   <h3 className="font-bold text-sm">Meeting Co-Pilot</h3>
                   <div className="flex items-center gap-2">
                      <div className={`h-1.5 w-1.5 rounded-full ${meeting.is_active ? 'bg-green-500' : 'bg-zinc-700'}`} />
                      <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                         {meeting.is_active ? 'Online' : 'Session Ended'}
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
                {messages.map((m, idx) => (
                  <motion.div 
                    key={idx}
                    initial={{ opacity: 0, x: m.role === 'user' ? 20 : -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[90%] p-4 rounded-2xl ${m.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none shadow-lg shadow-blue-600/10' : 'bg-white/5 border border-white/5 rounded-tl-none text-zinc-200'}`}>
                      <div className="prose prose-sm prose-invert max-w-none">
                          <ReactMarkdown>{m.text}</ReactMarkdown>
                      </div>
                    </div>
                  </motion.div>
                ))}
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

            {/* Controls — always rendered, disabled when meeting is over */}
            <div className={`p-6 border-t border-white/5 bg-black transition-opacity duration-300 ${!meeting.is_active ? 'opacity-30 grayscale pointer-events-none' : ''}`}>
               <div className="flex flex-col gap-4">
                  <div className="flex gap-2">
                     <input 
                       type="text"
                       value={inputText}
                       disabled={!meeting.is_active}
                       onChange={(e) => setInputText(e.target.value)}
                       onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
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
                    disabled={!meeting.is_active}
                    className={`h-20 rounded-2xl flex flex-col items-center justify-center gap-2 transition-all relative overflow-hidden group ${isRecording ? 'bg-red-500 shadow-2xl shadow-red-500/30 scale-[0.98]' : 'bg-zinc-900 hover:bg-zinc-900/80 border border-white/5 hover:border-white/10'}`}
                  >
                    <div className="z-10 flex flex-col items-center">
                      <Mic size={24} className={isRecording ? 'text-white' : 'text-zinc-500 group-hover:text-blue-400 transition-colors'} />
                      <span className={`text-[10px] font-black uppercase tracking-[0.2em] mt-1.5 ${isRecording ? 'text-white' : 'text-zinc-600 group-hover:text-zinc-400'}`}>
                        {isRecording ? 'Listening...' : 'Push to Talk'}
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

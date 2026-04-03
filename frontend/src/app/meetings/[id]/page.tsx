'use client';

import React, { useEffect, useState, useRef, use } from 'react';
import { getMeeting, sendChatText, sendChatAudio, sendBackgroundTranscript, summarizeMeeting } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { 
  Mic, MicOff, Send, MessageSquare, List, 
  FileText, Activity, Search, Command, CheckCircle2,
  MoreVertical, Home, Settings, ChevronRight
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
  const [viewedSummary, setViewedSummary] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  const backgroundRecorderRef = useRef<MediaRecorder | null>(null);
  const bgTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchMeeting();
    const interval = setInterval(fetchMeeting, 5000); 
    startBackgroundRecording(); 
    
    return () => {
      clearInterval(interval);
      if (bgTimeoutRef.current) clearTimeout(bgTimeoutRef.current);
      backgroundRecorderRef.current?.stop();
    };
  }, [id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [meeting?.transcript]);

  const fetchMeeting = async () => {
    try {
      const data = await getMeeting(id);
      setMeeting(data);
      if (data.summary_markdown) setViewedSummary(true);
    } catch (error) {
      console.error('Error fetching meeting:', error);
    }
  };

  const startBackgroundRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const recordChunk = () => {
        // We use a new recorder for each chunk to ensure it's a valid standalone file with headers
        const options = { mimeType: 'audio/webm' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
          options.mimeType = ''; // Default
        }
        
        const recorder = new MediaRecorder(stream, options);
        backgroundRecorderRef.current = recorder;
        const currentChunks: Blob[] = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) currentChunks.push(e.data);
        };

        recorder.onstop = async () => {
          const blob = new Blob(currentChunks, { type: options.mimeType || 'audio/webm' });
          if (blob.size > 100) { // Avoid sending tiny/empty chunks
            sendBackgroundTranscript(id, blob).then(() => fetchMeeting());
          }
          // Schedule next chunk
          bgTimeoutRef.current = setTimeout(recordChunk, 100);
        };

        recorder.start();
        // Record for 20 seconds then stop to trigger onstop/upload
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
    try {
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
    mediaRecorderRef.current?.stream.getTracks().forEach(track => track.stop());
  };

  const handleSendText = async () => {
    if (!inputText.trim()) return;
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
      const resp = await summarizeMeeting(id);
      setViewedSummary(true);
      fetchMeeting();
    } catch (err) {
      console.error('Error ending meeting:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!meeting) return <div className="h-screen bg-black flex items-center justify-center text-zinc-500">Loading Session...</div>;

  return (
    <div className="h-screen flex flex-col bg-black text-zinc-100 overflow-hidden">
      {/* Top Navbar */}
      <nav className="h-16 border-b border-white/5 flex items-center justify-between px-6 shrink-0 bg-black/50 backdrop-blur-md z-10">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/meetings')} className="p-2 hover:bg-white/5 rounded-xl transition-colors">
            <Home size={20} />
          </button>
          <div className="h-4 w-px bg-white/10" />
          <h2 className="font-semibold text-lg">{meeting.title}</h2>
          {meeting.is_active ? (
            <div className="flex items-center gap-2 bg-red-500/10 px-3 py-1 rounded-full border border-red-500/20">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs font-bold text-red-500 uppercase tracking-tighter tracking-widest">Listening...</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-zinc-800 px-3 py-1 rounded-full border border-white/10 text-zinc-400">
              <CheckCircle2 size={12} />
              <span className="text-xs font-bold uppercase tracking-tighter">Archived</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {meeting.is_active && (
            <button 
              onClick={handleEndMeeting}
              className="bg-zinc-100 text-black px-4 py-2 rounded-xl text-sm font-bold hover:bg-white transition-all disabled:opacity-50"
              disabled={isProcessing}
            >
              End Session & Summarize
            </button>
          )}
        </div>
      </nav>

      <main className="flex-1 flex overflow-hidden">
        {/* Left: Transcript */}
        <section className="flex-1 border-r border-white/5 flex flex-col min-w-0">
          <div className="p-6 border-b border-white/5 flex justify-between items-center bg-black/20">
            <div className="flex items-center gap-2 text-zinc-400 font-medium">
              <FileText size={18} />
              <span>Live Transcript</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-8 space-y-6 scrollbar-hide">
            <div className="prose prose-invert max-w-none prose-p:text-zinc-400 prose-strong:text-white prose-p:leading-relaxed">
              <ReactMarkdown>{meeting.transcript || "*Awaiting audio transcription... Speak to begin.*"}</ReactMarkdown>
            </div>
            <div ref={transcriptEndRef} />
          </div>
        </section>

        {/* Right: Co-Pilot Chat / Summary View */}
        <section className="w-[450px] flex flex-col shrink-0 bg-zinc-950/50">
          {viewedSummary && meeting.summary_markdown ? (
            <div className="flex-1 flex flex-col">
              <div className="p-6 border-b border-white/5 bg-blue-500/10 text-white flex items-center gap-3">
                <div className="p-2 bg-blue-500 rounded-lg shadow-lg shadow-blue-500/20">
                  <List size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-lg">Implementation Plan</h3>
                  <p className="text-xs text-blue-300 font-medium uppercase tracking-widest">AI Generated Summary</p>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-8 space-y-6">
                <div className="prose prose-invert prose-blue prose-h1:text-2xl prose-h2:text-xl prose-p:text-zinc-400 prose-li:text-zinc-400">
                  <ReactMarkdown>{meeting.summary_markdown}</ReactMarkdown>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col h-full bg-black">
              <div className="p-6 border-b border-white/5 flex justify-between items-center bg-zinc-900/10 backdrop-blur-md">
                <div className="flex items-center gap-3">
                   <div className="p-2 bg-zinc-800 rounded-xl border border-white/10">
                     <Activity size={20} className="text-blue-500" />
                   </div>
                   <div>
                     <h3 className="font-bold">Agno Copilot</h3>
                     <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Web Search Enabled</p>
                   </div>
                </div>
                <MoreVertical size={20} className="text-zinc-600" />
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <AnimatePresence initial={false}>
                  {messages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-center space-y-4 px-8 mt-12">
                      <div className="p-4 bg-zinc-900 rounded-2xl border border-white/5">
                        <MessageSquare size={32} />
                      </div>
                      <p className="text-sm">Ask me about current topics, or use Push-to-Talk to chat naturally.</p>
                    </div>
                  )}
                  {messages.map((m, idx) => (
                    <motion.div 
                      key={idx}
                      initial={{ opacity: 0, x: m.role === 'user' ? 20 : -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[85%] p-4 rounded-2xl ${m.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'glass rounded-tl-none text-zinc-200'}`}>
                        <p className="text-sm leading-relaxed">{m.text}</p>
                      </div>
                    </motion.div>
                  ))}
                  {isProcessing && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                      <div className="glass p-4 rounded-2xl rounded-tl-none">
                        <div className="flex gap-1.5">
                          <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" />
                          <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                          <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:0.4s]" />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div ref={chatEndRef} />
              </div>

              {/* Controls */}
              <div className="p-6 border-t border-white/5 bg-zinc-950/80">
                 <div className="flex flex-col gap-4">
                    <div className="flex gap-2">
                       <input 
                         type="text"
                         value={inputText}
                         onChange={(e) => setInputText(e.target.value)}
                         onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                         placeholder="Ask anything..."
                         className="flex-1 bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-blue-500/50 transition-all text-sm placeholder:text-zinc-600"
                        />
                        <button 
                          onClick={handleSendText}
                          className="bg-blue-600 hover:bg-blue-500 p-3 rounded-xl transition-all shadow-lg shadow-blue-600/20"
                        >
                          <Send size={18} />
                        </button>
                    </div>
                    
                    <button 
                      onMouseDown={startRecording}
                      onMouseUp={stopRecording}
                      onMouseLeave={isRecording ? stopRecording : undefined}
                      className={`h-20 rounded-2xl flex flex-col items-center justify-center gap-2 transition-all relative overflow-hidden group ${isRecording ? 'bg-red-500 shadow-lg shadow-red-500/20' : 'bg-zinc-900 hover:bg-zinc-800 border border-white/10'}`}
                    >
                      <div className="z-10 flex flex-col items-center">
                        <Mic size={24} className={isRecording ? 'animate-pulse text-white' : 'text-zinc-400 group-hover:text-white transition-colors'} />
                        <span className={`text-[10px] font-black uppercase tracking-widest mt-1 ${isRecording ? 'text-white' : 'text-zinc-500 group-hover:text-zinc-300'}`}>
                          {isRecording ? 'Recording Chunk...' : 'Push to Talk'}
                        </span>
                      </div>
                      {isRecording && (
                        <motion.div 
                          initial={{ scale: 0.5, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          className="absolute inset-0 bg-red-400/20"
                        />
                      )}
                    </button>
                 </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

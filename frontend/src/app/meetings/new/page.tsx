'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createMeeting, startMeeting, getModels, addContextFile, addContextText, deleteContextItem } from '@/lib/api';
import {
  ArrowLeft, Plus, Upload, FileText, X, ChevronDown,
  Play, Mic, Sparkles, Loader2, File as FileIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ModelOption {
  id: string;
  provider: string;
  display_name: string;
}

interface ContextItem {
  type: 'text' | 'file';
  name: string;
  content: string;
}

export default function NewMeetingPage() {
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [copilotModels, setCopilotModels] = useState<ModelOption[]>([]);
  const [summarizerModels, setSummarizerModels] = useState<ModelOption[]>([]);
  const [selectedCopilot, setSelectedCopilot] = useState<string>('');
  const [selectedSummarizer, setSelectedSummarizer] = useState<string>('');
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [textNote, setTextNote] = useState('');
  const [textNoteName, setTextNoteName] = useState('');
  const [showTextNote, setShowTextNote] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);  // created after first load
  const [modelsLoading, setModelsLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Create the meeting stub as soon as the page mounts
  useEffect(() => {
    const init = async () => {
      try {
        setModelsLoading(true);
        const [modelsData, { session_id }] = await Promise.all([
          getModels(),
          createMeeting({ title: 'New Meeting' }),
        ]);
        setCopilotModels(modelsData.copilot_models);
        setSummarizerModels(modelsData.summarizer_models);
        if (modelsData.copilot_models.length) setSelectedCopilot(modelsData.copilot_models[0].id);
        if (modelsData.summarizer_models.length) setSelectedSummarizer(modelsData.summarizer_models[0].id);
        setSessionId(session_id);
      } catch (e) {
        console.error('Setup init failed:', e);
      } finally {
        setModelsLoading(false);
      }
    };
    init();
  }, []);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || !sessionId) return;
    for (const file of Array.from(files)) {
      try {
        const { items } = await addContextFile(sessionId, file);
        setContextItems(items);
      } catch (e) {
        console.error('File upload error:', e);
      }
    }
  };

  const handleAddTextNote = async () => {
    if (!textNote.trim() || !sessionId) return;
    try {
      const { items } = await addContextText(sessionId, textNote, textNoteName || 'Text note');
      setContextItems(items);
      setTextNote('');
      setTextNoteName('');
      setShowTextNote(false);
    } catch (e) {
      console.error('Text note error:', e);
    }
  };

  const handleDeleteContextItem = async (index: number) => {
    if (!sessionId) return;
    try {
      const { items } = await deleteContextItem(sessionId, index);
      setContextItems(items);
    } catch (e) {
      console.error('Delete context error:', e);
    }
  };

  const handleStartMeeting = async () => {
    if (!sessionId || isStarting) return;
    setIsStarting(true);
    try {
      // Update models if changed from defaults
      const { updateMeeting } = await import('@/lib/api');
      await updateMeeting(sessionId, {
        title: title.trim() || `Meeting ${sessionId.slice(0, 8)}`,
        copilot_model_id: selectedCopilot,
        summarizer_model_id: selectedSummarizer,
      });
      await startMeeting(sessionId);
      router.push(`/meetings/${sessionId}`);
    } catch (e) {
      console.error('Start meeting error:', e);
      setIsStarting(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileUpload(e.dataTransfer.files);
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col">
      {/* Navbar */}
      <nav className="h-16 border-b border-white/5 flex items-center px-6 gap-4 bg-black/80 backdrop-blur-xl z-20 shrink-0">
        <button
          onClick={() => router.push('/meetings')}
          className="p-2 hover:bg-white/5 rounded-xl transition-all"
        >
          <ArrowLeft size={20} className="text-zinc-400" />
        </button>
        <div className="h-4 w-px bg-white/10" />
        <div className="flex items-center gap-2">
          <Mic size={16} className="text-blue-500" />
          <span className="font-bold text-sm tracking-tight">New Meeting Setup</span>
        </div>
      </nav>

      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-12 flex flex-col gap-10">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-black tracking-tight mb-1">Configure Your Meeting</h1>
          <p className="text-zinc-500 text-sm">Set up context materials and AI models before starting.</p>
        </div>

        {/* Meeting Title */}
        <section className="space-y-3">
          <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Meeting Title</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={`Meeting ${sessionId?.slice(0, 8) ?? '...'}`}
            className="w-full bg-zinc-900 border border-white/10 rounded-2xl px-5 py-4 text-lg font-medium outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/40 transition-all placeholder:text-zinc-700"
          />
        </section>

        {/* Model Selection */}
        <section className="space-y-4">
          <label className="text-xs font-black uppercase tracking-widest text-zinc-500">AI Models</label>
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-zinc-600">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm">Loading models...</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <ModelSelect
                label="Co-Pilot Model"
                icon={<Mic size={14} />}
                options={copilotModels}
                value={selectedCopilot}
                onChange={setSelectedCopilot}
              />
              <ModelSelect
                label="Summarizer Model"
                icon={<Sparkles size={14} />}
                options={summarizerModels}
                value={selectedSummarizer}
                onChange={setSelectedSummarizer}
              />
            </div>
          )}
        </section>

        {/* Context Materials */}
        <section className="space-y-4">
          <label className="text-xs font-black uppercase tracking-widest text-zinc-500">
            Context Materials <span className="text-zinc-700 normal-case font-normal">(optional)</span>
          </label>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
              isDragging
                ? 'border-blue-500/60 bg-blue-500/5'
                : 'border-white/10 hover:border-white/20 hover:bg-white/[0.02]'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept=".txt,.md,.pdf,.docx,.csv,.json,.py,.js,.ts,.html,.yaml,.yml"
              onChange={e => handleFileUpload(e.target.files)}
            />
            <Upload size={28} className={`mx-auto mb-3 ${isDragging ? 'text-blue-400' : 'text-zinc-600'}`} />
            <p className="text-sm font-medium text-zinc-400">
              Drop files here or <span className="text-blue-400">browse</span>
            </p>
            <p className="text-xs text-zinc-600 mt-1">PDF, DOCX, TXT, MD, JSON, code files...</p>
          </div>

          {/* Add text note toggle */}
          <button
            onClick={() => setShowTextNote(v => !v)}
            className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <Plus size={16} />
            Add text note
          </button>

          <AnimatePresence>
            {showTextNote && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="bg-zinc-900 border border-white/10 rounded-2xl p-4 space-y-3">
                  <input
                    type="text"
                    value={textNoteName}
                    onChange={e => setTextNoteName(e.target.value)}
                    placeholder="Note title (optional)"
                    className="w-full bg-zinc-800 border border-white/5 rounded-xl px-4 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500/30 placeholder:text-zinc-700"
                  />
                  <textarea
                    value={textNote}
                    onChange={e => setTextNote(e.target.value)}
                    placeholder="Enter context, agenda, background info..."
                    rows={4}
                    className="w-full bg-zinc-800 border border-white/5 rounded-xl px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-blue-500/30 placeholder:text-zinc-700 resize-none"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => { setShowTextNote(false); setTextNote(''); setTextNoteName(''); }}
                      className="px-4 py-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                    >Cancel</button>
                    <button
                      onClick={handleAddTextNote}
                      disabled={!textNote.trim()}
                      className="px-4 py-2 text-xs bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-bold disabled:opacity-40 transition-all"
                    >Add Note</button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Context items list */}
          <AnimatePresence>
            {contextItems.length > 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                {contextItems.map((item, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex items-center gap-3 bg-zinc-900 border border-white/5 rounded-xl px-4 py-3"
                  >
                    <div className="p-1.5 bg-zinc-800 rounded-lg">
                      {item.type === 'file' ? (
                        <FileIcon size={14} className="text-blue-400" />
                      ) : (
                        <FileText size={14} className="text-purple-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <p className="text-xs text-zinc-600">{item.type === 'file' ? 'File' : 'Text note'} • {item.content.length.toLocaleString()} chars</p>
                    </div>
                    <button
                      onClick={() => handleDeleteContextItem(idx)}
                      className="p-1.5 hover:bg-red-500/10 rounded-lg text-zinc-600 hover:text-red-400 transition-all"
                    >
                      <X size={14} />
                    </button>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Start Button */}
        <div className="pt-4">
          <button
            onClick={handleStartMeeting}
            disabled={isStarting || !sessionId}
            className="w-full h-16 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-2xl flex items-center justify-center gap-3 font-black text-lg tracking-tight transition-all hover:shadow-2xl hover:shadow-blue-600/30 group"
          >
            {isStarting ? (
              <><Loader2 size={22} className="animate-spin" /> Starting...</>
            ) : (
              <><Play size={22} className="group-hover:scale-110 transition-transform" /> Start Meeting</>
            )}
          </button>
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ModelSelect({
  label, icon, options, value, onChange
}: {
  label: string;
  icon: React.ReactNode;
  options: ModelOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-zinc-500 font-bold uppercase tracking-widest">
        {icon}
        {label}
      </div>
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full appearance-none bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 pr-10 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/40 transition-all cursor-pointer"
        >
          {options.map(opt => (
            <option key={opt.id} value={opt.id}>{opt.display_name}</option>
          ))}
        </select>
        <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
      </div>
    </div>
  );
}

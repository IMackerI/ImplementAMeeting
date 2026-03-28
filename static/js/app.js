/**
 * app.js — Meeting Recorder frontend application
 * 
 * Sections:
 *   1. DOM refs & state
 *   2. Utilities (toast, timer)
 *   3. Context card logic
 *   4. Recording logic
 *   5. Chat logic
 *   6. Summary logic
 *   7. Model loading & init
 */

(() => {
  'use strict';

  // =========================================================================
  // 1. DOM REFS & STATE
  // =========================================================================

  const $ = (id) => document.getElementById(id);

  const startBtn           = $('startBtn');
  const pauseBtn           = $('pauseBtn');
  const stopBtn            = $('stopBtn');
  const timer              = $('timer');
  const chunkStatus        = $('chunkStatus');
  const pulseRing1         = $('pulseRing1');
  const pulseRing2         = $('pulseRing2');
  const micIcon            = $('micIcon');
  const processingStatus   = $('processingStatus');
  const processingText     = $('processingText');
  const resultsCard        = $('resultsCard');
  const transcriptDisplay  = $('transcriptDisplay');
  const summaryTextarea    = $('summaryTextarea');
  const editPromptInput    = $('editPromptInput');
  const updateBtn          = $('updateBtn');
  const summaryModelSelect = $('summaryModelSelect');
  const chatModelSelect    = $('chatModelSelect');
  const chatCard           = $('chatCard');
  const chatHistory        = $('chatHistory');
  const chatInput          = $('chatInput');
  const sendChatBtn        = $('sendChatBtn');
  const searchToggle       = $('searchToggle');
  const summaryPreview     = $('summaryPreview');
  const toggleEditBtn      = $('toggleEditBtn');
  const chunkIntervalInput = $('chunkInterval');
  const toastContainer     = $('toastContainer');

  // Context card
  const contextTextarea    = $('contextTextarea');
  const addContextBtn      = $('addContextBtn');
  const contextFileInput   = $('contextFileInput');
  const contextDropZone    = $('contextDropZone');
  const contextItemsList   = $('contextItemsList');

  // State
  let mediaRecorder   = null;
  let chunkTimer      = null;
  let allTranscripts  = [];
  let chunkIndex      = 0;
  let timerInterval   = null;
  let secondsElapsed  = 0;
  let isRecording     = false;
  let currentSessionId = null;

  // =========================================================================
  // 2. UTILITIES
  // =========================================================================

  function formatTime(s) {
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${sec}`;
  }

  function showToast(msg, type = 'error') {
    const el = document.createElement('div');
    el.className = `toast text-xs px-5 py-4 rounded-xl shadow-2xl font-bold uppercase tracking-widest ${
      type === 'error'   ? 'bg-rose-900/90 text-rose-100 border border-rose-500/30' :
      type === 'success' ? 'bg-emerald-900/90 text-emerald-100 border border-emerald-500/30' :
                           'bg-slate-800/90 text-slate-200 border border-slate-600/30'
    } backdrop-blur-xl`;
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(10px)';
      setTimeout(() => el.remove(), 300);
    }, 4000);
  }

  function startTimerDisplay() {
    timer.textContent = formatTime(secondsElapsed);
    timer.classList.remove('hidden');
    timerInterval = setInterval(() => {
      secondsElapsed++;
      timer.textContent = formatTime(secondsElapsed);
    }, 1000);
  }

  function stopTimerDisplay(hide = true) {
    clearInterval(timerInterval);
    if (hide) timer.classList.add('hidden');
  }

  function setRecordingUI(active) {
    isRecording = active;
    startBtn.disabled = active;
    pauseBtn.disabled = !active;
    stopBtn.disabled  = !active;
    
    startBtn.textContent = currentSessionId ? 'Resume Meeting' : 'Start Meeting';
    startBtn.classList.toggle('bg-indigo-600', !active);
    startBtn.classList.toggle('bg-slate-700', active);

    pulseRing1.classList.toggle('hidden', !active);
    pulseRing2.classList.toggle('hidden', !active);
    micIcon.classList.toggle('text-red-500', active);
    micIcon.classList.toggle('border-red-500/50', active);
    micIcon.classList.toggle('text-slate-500', !active);
    micIcon.classList.toggle('border-slate-700', !active);
    if (active) {
      chatCard.classList.remove('hidden');
    } else {
      chunkStatus.classList.add('hidden');
    }
  }

  function setProcessing(show, text = 'Processing…') {
    processingStatus.classList.toggle('hidden', !show);
    processingText.textContent = text;
    startBtn.disabled = show || isRecording;
    pauseBtn.disabled = show || !isRecording;
    stopBtn.disabled  = show;
  }

  function showResults() {
    resultsCard.classList.remove('hidden');
    resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // =========================================================================
  // 3. CONTEXT CARD
  // =========================================================================

  function ensureSessionId() {
    if (!currentSessionId) {
      // Generate a session ID early so context can be added before recording
      currentSessionId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15).replace(/(\d{8})(\d{6})/, '$1_$2').slice(0, 15);
      // Format: YYYYMMDD_HHMMSS
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      currentSessionId = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    }
    return currentSessionId;
  }

  async function refreshContextList() {
    const sid = currentSessionId;
    if (!sid) {
      renderContextItems([]);
      return;
    }
    try {
      const res = await fetch(`/context/${sid}`);
      const data = await res.json();
      renderContextItems(data.items);
    } catch (err) {
      console.error('Failed to load context:', err);
    }
  }

  function renderContextItems(items) {
    if (!contextItemsList) return;
    contextItemsList.innerHTML = '';
    if (!items || items.length === 0) {
      contextItemsList.innerHTML = '<div class="text-[10px] text-slate-600 italic text-center py-2">No context items yet</div>';
      return;
    }
    items.forEach((item, idx) => {
      const div = document.createElement('div');
      div.className = 'context-item';
      const badge = item.type === 'file' ? 'FILE' : 'TEXT';
      const nameText = item.name || 'Text note';

      div.innerHTML = `
        <span class="context-item-badge">${badge}</span>
        <span class="context-item-name" title="${nameText}">${nameText}</span>
        <button class="context-item-delete" data-index="${idx}" title="Remove">✕</button>
      `;
      contextItemsList.appendChild(div);
    });

    // Bind delete buttons
    contextItemsList.querySelectorAll('.context-item-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const index = btn.dataset.index;
        try {
          await fetch(`/context/${currentSessionId}/${index}`, { method: 'DELETE' });
          await refreshContextList();
          showToast('Removed', 'info');
        } catch (err) {
          showToast('Delete failed', 'error');
        }
      });
    });
  }

  addContextBtn.addEventListener('click', async () => {
    const text = contextTextarea.value.trim();
    if (!text) return;
    const sid = ensureSessionId();
    try {
      const res = await fetch('/context/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, text }),
      });
      const data = await res.json();
      renderContextItems(data.items);
      contextTextarea.value = '';
      showToast('Context added', 'success');
    } catch (err) {
      showToast('Failed to add context', 'error');
    }
  });

  async function uploadFile(file) {
    const sid = ensureSessionId();
    const form = new FormData();
    form.append('file', file);
    form.append('session_id', sid);
    try {
      const res = await fetch('/context/upload', { method: 'POST', body: form });
      const data = await res.json();
      renderContextItems(data.items);
      showToast(`Uploaded: ${file.name}`, 'success');
    } catch (err) {
      showToast(`Upload failed: ${file.name}`, 'error');
    }
  }

  contextFileInput.addEventListener('change', (e) => {
    for (const file of e.target.files) uploadFile(file);
    contextFileInput.value = '';
  });

  contextDropZone.addEventListener('click', () => contextFileInput.click());
  contextDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    contextDropZone.classList.add('drag-over');
  });
  contextDropZone.addEventListener('dragleave', () => {
    contextDropZone.classList.remove('drag-over');
  });
  contextDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    contextDropZone.classList.remove('drag-over');
    for (const file of e.dataTransfer.files) uploadFile(file);
  });

  // =========================================================================
  // 4. RECORDING
  // =========================================================================

  async function flushChunk(blob) {
    if (!blob || blob.size === 0) return;

    const idx = chunkIndex++;
    const ext = (mediaRecorder.mimeType || '').includes('ogg') ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('audio', blob, `chunk_${idx}.${ext}`);
    form.append('chunk_index', String(idx));
    if (currentSessionId) form.append('session_id', currentSessionId);

    chunkStatus.textContent = `• Transcribing chunk ${idx + 1}…`;
    chunkStatus.classList.remove('hidden');

    try {
      const res = await fetch('/transcribe-chunk', { method: 'POST', body: form });
      const data = await res.json();
      
      if (!currentSessionId && data.session_id) {
        currentSessionId = data.session_id;
        showToast('Session Active', 'success');
      }

      if (data.transcript) {
        allTranscripts.push(data.transcript);
        transcriptDisplay.textContent = allTranscripts.join('\n\n');
        if (allTranscripts.length === 1) {
          appendChatMessage('ai', 'Recording started. I will analyze the meeting context as it arrives. Feel free to ask questions anytime!');
        }
      }
      chunkStatus.textContent = `✓ Chunk ${idx + 1} finalized`;
      appendTimelineMarker(secondsElapsed);
    } catch (err) {
      chunkStatus.textContent = `⚠ Chunk ${idx + 1} error`;
      showToast(`Sync Failed: ${idx + 1}`, 'error');
    }
  }

  async function startRecordingFlow() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      showToast('Mic Denied', 'error');
      return;
    }

    // Ensure session ID exists (may have been created by context)
    ensureSessionId();

    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.addEventListener('dataavailable', e => {
      if (e.data && e.data.size > 0) flushChunk(e.data);
    });

    mediaRecorder.start();
    setRecordingUI(true);
    startTimerDisplay();

    const intervalMs = Math.max(10, Number(chunkIntervalInput.value) || 30) * 1000;
    chunkTimer = setInterval(() => {
      if (mediaRecorder?.state === 'recording') {
        mediaRecorder.stop(); 
        mediaRecorder.start();
      }
    }, intervalMs);
  }

  startBtn.addEventListener('click', () => {
    if (!currentSessionId) {
      allTranscripts = [];
      chunkIndex = 0;
      chatHistory.innerHTML = '';
      secondsElapsed = 0;
    }
    startRecordingFlow();
  });

  pauseBtn.addEventListener('click', () => {
    if (mediaRecorder?.state !== 'recording') return;
    setRecordingUI(false);
    stopTimerDisplay(false);
    if (chunkTimer) clearInterval(chunkTimer);
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
    showToast('Meeting Paused', 'info');
  });

  stopBtn.addEventListener('click', async () => {
    if (mediaRecorder?.state === 'recording') {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    
    setRecordingUI(false);
    stopTimerDisplay(true);
    if (chunkTimer) clearInterval(chunkTimer);

    setProcessing(true, 'Analyzing meeting data…');
    await new Promise(r => setTimeout(r, 2000));

    if (allTranscripts.length === 0) {
      setProcessing(false);
      showToast('Empty Session', 'error');
      return;
    }

    try {
      const res = await fetch('/summarise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_transcript: allTranscripts.join('\n\n'),
          model: summaryModelSelect.value,
          session_id: currentSessionId,
        }),
      });
      const { summary } = await res.json();
      summaryTextarea.value = summary;
      renderSummary();
      setProcessing(false);
      showResults();
      showToast('Ready', 'success');
    } catch (err) {
      setProcessing(false);
      showToast('Summary Failed', 'error');
    }
  });

  // =========================================================================
  // 5. CHAT
  // =========================================================================

  function appendChatMessage(role, text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `p-5 rounded-2xl text-sm max-w-[90%] border ${
      role === 'user' 
        ? 'bg-indigo-600/10 border-indigo-500/20 self-end ml-auto text-slate-100 shadow-lg' 
        : 'bg-slate-800/40 border-slate-700/50 self-start text-slate-200'
    }`;
    
    const roleLabel = `<div class="text-[9px] uppercase font-bold tracking-[0.2em] text-slate-500 mb-3">${role === 'ai' ? 'Assistant' : 'Speaker'}</div>`;
    const content = `<div class="prose prose-invert">${DOMPurify.sanitize(marked.parse(text))}</div>`;
    
    msgDiv.innerHTML = roleLabel + content;
    chatHistory.appendChild(msgDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }

  function appendTimelineMarker(seconds) {
    const marker = document.createElement('div');
    marker.className = 'flex items-center gap-4 my-4 opacity-40 select-none';
    marker.innerHTML = `
      <div class="flex-1 h-px bg-slate-700"></div>
      <div class="text-[9px] uppercase font-bold tracking-[0.2em] whitespace-nowrap">
        Received up to ${formatTime(seconds)}
      </div>
      <div class="flex-1 h-px bg-slate-700"></div>
    `;
    chatHistory.appendChild(marker);
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }

  async function handleChat() {
    const question = chatInput.value.trim();
    if (!question) return;
    chatInput.value = '';
    appendChatMessage('user', question);

    try {
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: currentSessionId || '',
          user_prompt: question,
          model: chatModelSelect.value,
          enable_search: searchToggle.checked,
        }),
      });
      const data = await res.json();
      appendChatMessage('ai', data.response);
    } catch (err) {
      console.error('Chat error:', err);
      showToast(`Chat Error: ${err.message}`, 'error');
      appendChatMessage('ai', `⚠️ Error: ${err.message}. Please check if the selected model supports the current configuration.`);
    }
  }

  sendChatBtn.addEventListener('click', handleChat);
  chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleChat(); });

  // =========================================================================
  // 6. SUMMARY
  // =========================================================================

  function renderSummary() {
    summaryPreview.innerHTML = DOMPurify.sanitize(marked.parse(summaryTextarea.value));
  }

  toggleEditBtn.addEventListener('click', () => {
    const isPreview = summaryPreview.classList.contains('hidden');
    if (isPreview) {
      renderSummary();
      summaryPreview.classList.remove('hidden');
      summaryTextarea.classList.add('hidden');
      toggleEditBtn.textContent = 'Edit Content';
    } else {
      summaryPreview.classList.add('hidden');
      summaryTextarea.classList.remove('hidden');
      toggleEditBtn.textContent = 'Preview View';
    }
  });

  updateBtn.addEventListener('click', async () => {
    const ep = editPromptInput.value.trim();
    if (!ep) return;
    setProcessing(true, 'Updating summary…');
    try {
      const res = await fetch('/edit-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_summary: summaryTextarea.value,
          edit_prompt: ep,
          model: summaryModelSelect.value,
          session_id: currentSessionId,
        }),
      });
      const { summary } = await res.json();
      summaryTextarea.value = summary;
      if (!summaryPreview.classList.contains('hidden')) renderSummary();
      editPromptInput.value = '';
      showToast('Updated', 'success');
    } catch (err) {
      showToast('Update Failed', 'error');
    } finally {
      setProcessing(false);
    }
  });

  // =========================================================================
  // 7. INIT — Load models
  // =========================================================================

  (async () => {
    try {
      const res = await fetch('/models');
      const { models, default: def } = await res.json();
      const options = models.map(m =>
        `<option value="${m}" ${m === def ? 'selected' : ''}>${m.replace('models/', '')}</option>`
      ).join('');
      summaryModelSelect.innerHTML = options;
      chatModelSelect.innerHTML = options;
    } catch {
      const fallback = '<option value="models/gemini-2.0-flash">gemini-2.0-flash</option>';
      summaryModelSelect.innerHTML = fallback;
      chatModelSelect.innerHTML = fallback;
    }
  })();

})();

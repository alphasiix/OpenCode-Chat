// OpenCode Claude - app logic
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let serverUrl = 'http://127.0.0.1:4096';
let currentSessionId = null;
let sessions = [];
let messagesCache = new Map(); // sessionId -> messages
let models = []; // {providerID, modelID, name}
let agents = [];
let isStreaming = false;
let eventSource = null;
let pollingTimer = null;

// Elements
const sessionListToday = $('#sessionsToday');
const sessionListOlder = $('#sessionsOlder');
const searchInput = $('#searchInput');
const messagesEl = $('#messages');
const emptyState = $('#emptyState');
const promptInput = $('#promptInput');
const sendBtn = $('#sendBtn');
const newChatBtn = $('#newChatBtn');
const modelSelect = $('#modelSelect');
const agentSelect = $('#agentSelect');
const sessionTitleEl = $('#sessionTitle');
const sessionModelEl = $('#sessionModel');
const serverUrlInput = $('#serverUrlInput');
const serverSaveBtn = $('#serverSaveBtn');
const serverStatus = $('#serverStatus');
const serverInfo = $('#serverInfo');
const projectPathEl = $('#projectPath');
const statusBar = $('#statusBar');
const statusText = $('#statusText');
const todoProgress = $('#todoProgress');

function apiUrl(path) {
  return serverUrl.replace(/\/$/, '') + path;
}

async function apiFetch(path, opts = {}) {
  const url = apiUrl(path);
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  if (!res.ok) {
    const txt = await res.text().catch(()=>'');
    throw new Error(`${res.status} ${res.statusText} ${txt.slice(0,300)}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

// --- Server config ---
async function initServer() {
  if (window.opencodeAPI) {
    try {
      const cfg = await window.opencodeAPI.getServerConfig();
      serverUrl = cfg.url;
      serverUrlInput.value = serverUrl;
      $('#settingsUrl').value = serverUrl;
      const workdir = await window.opencodeAPI.getWorkdir();
      projectPathEl.textContent = workdir;
      projectPathEl.title = workdir;
      $('#settingsProject').value = workdir;
    } catch {}
  }
  // try to connect
  const ok = await checkServer();
  if (ok) {
    await loadAll();
    connectSSE();
  } else {
    setServerStatus('disconnected', 'Déconnecté');
    serverInfo.textContent = 'Serveur non joignable — lance opencode serve';
    // retry every 3s
    setTimeout(async () => {
      const ok2 = await checkServer();
      if (ok2) {
        await loadAll();
        connectSSE();
      }
    }, 3000);
  }
}

async function checkServer() {
  try {
    if (window.opencodeAPI) {
      const r = await window.opencodeAPI.checkServer();
      serverUrl = r.url;
      serverUrlInput.value = serverUrl;
      const alive = r.alive;
      setServerStatus(alive ? 'connected' : 'disconnected', alive ? 'Connecté' : 'Déconnecté');
      serverInfo.textContent = alive ? `✓ ${serverUrl}` : `✗ ${serverUrl} indisponible`;
      return alive;
    } else {
      const res = await fetch(apiUrl('/global/health'));
      const ok = res.ok;
      setServerStatus(ok ? 'connected' : 'disconnected', ok ? 'Connecté' : 'Déconnecté');
      return ok;
    }
  } catch {
    setServerStatus('disconnected', 'Déconnecté');
    return false;
  }
}

function setServerStatus(state, text) {
  serverStatus.className = 'server-status ' + state;
  serverStatus.querySelector('.status-text').textContent = text;
  if (state === 'connected') serverInfo.textContent = `✓ ${serverUrl}`;
}

// --- Loaders ---
async function loadAll() {
  await Promise.allSettled([loadProviders(), loadAgents(), loadSessions(), loadProject()]);
}

async function loadProject() {
  try {
    const proj = await apiFetch('/project/current').catch(()=> null);
    if (proj && proj.worktree) {
      projectPathEl.textContent = proj.worktree;
      projectPathEl.title = proj.worktree;
    } else {
      const p = await apiFetch('/path').catch(()=>null);
      if (p && p.directory) {
        projectPathEl.textContent = p.directory;
        projectPathEl.title = p.directory;
      }
    }
  } catch {}
}

async function loadProviders() {
  try {
    const data = await apiFetch('/config/providers');
    // Expected {providers:[{id, name, models:[{id,name}]}], default:{}}
    // or {providers: Provider[], default: {...}}
    // Fallback /provider
    let list = [];
    if (data.providers) {
      // could be array or object
      if (Array.isArray(data.providers)) {
        data.providers.forEach(p => {
          if (p.models) p.models.forEach(m => list.push({ providerID: p.id, modelID: m.id, label: `${p.name || p.id} / ${m.name || m.id}` }));
          else list.push({ providerID: p.id, modelID: '', label: p.name || p.id });
        });
      }
    }
    if (list.length === 0) {
      const alt = await apiFetch('/provider').catch(()=>null);
      if (alt && alt.all) {
        alt.all.forEach(p => {
          const modelsArr = p.models || [];
          modelsArr.forEach(m => list.push({ providerID: p.id, modelID: m.id || m, label: `${p.name || p.id} / ${m.name || m.id || m}` }));
        });
      }
    }
    models = list;
    renderModelSelect();
  } catch (e) {
    console.warn('providers', e);
    modelSelect.innerHTML = '<option value="">Aucun modèle (configurer provider)</option>';
  }
}

async function loadAgents() {
  try {
    const data = await apiFetch('/agent');
    agents = Array.isArray(data) ? data : (data.agents || []);
    // populate select
    agentSelect.innerHTML = '';
    const defaults = ['build','plan'];
    const names = agents.length ? agents.map(a=> a.name || a.id) : defaults;
    names.forEach(n => {
      const o = document.createElement('option');
      o.value = n; o.textContent = n;
      agentSelect.appendChild(o);
    });
    if (!names.includes('build')) {
      const o = document.createElement('option'); o.value='build'; o.textContent='build'; agentSelect.appendChild(o);
    }
  } catch {
    // keep defaults
  }
}

async function loadSessions() {
  try {
    const data = await apiFetch('/session');
    sessions = Array.isArray(data) ? data : (data.sessions || data || []);
    // sort by updatedAt/time desc
    sessions.sort((a,b)=> new Date(b.time?.updated || b.updatedAt || b.createdAt || 0) - new Date(a.time?.updated || a.time?.updated || a.updatedAt || 0));
    renderSessions();
  } catch (e) {
    console.warn('sessions', e);
    sessions = [];
    renderSessions();
  }
}

function renderModelSelect() {
  if (!models.length) {
    modelSelect.innerHTML = '<option value="">Aucun modèle</option>';
    return;
  }
  modelSelect.innerHTML = '';
  models.forEach(m => {
    const o = document.createElement('option');
    o.value = JSON.stringify({ providerID: m.providerID, modelID: m.modelID });
    o.textContent = m.label;
    modelSelect.appendChild(o);
  });
  // try restore last
  const saved = localStorage.getItem('opencode:model');
  if (saved) {
    for (const opt of modelSelect.options) {
      if (opt.value === saved) { modelSelect.value = saved; break; }
    }
  }
  updateSessionModelBadge();
}

function updateSessionModelBadge() {
  const v = modelSelect.value;
  if (!v) { sessionModelEl.textContent = ''; return; }
  try {
    const { providerID, modelID } = JSON.parse(v);
    sessionModelEl.textContent = `${providerID}/${modelID}`;
  } catch { sessionModelEl.textContent = v; }
}

function renderSessions() {
  const filter = (searchInput.value || '').toLowerCase();
  let filtered = sessions;
  if (filter) {
    filtered = sessions.filter(s => (s.title || s.id || '').toLowerCase().includes(filter) || (s.summary || '').toLowerCase().includes(filter));
  }
  sessionListToday.innerHTML = '';
  sessionListOlder.innerHTML = '';

  if (!filtered.length) {
    sessionListToday.innerHTML = '<div style="padding:12px;color:var(--text-faint);font-size:13px;">Aucune conversation</div>';
    return;
  }
  const now = Date.now();
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayTs = todayStart.getTime();

  filtered.forEach(s => {
    const t = new Date(s.time?.updated || s.time?.created || s.updatedAt || s.createdAt || Date.now()).getTime();
    const el = createSessionEl(s);
    if (t >= todayTs) sessionListToday.appendChild(el);
    else sessionListOlder.appendChild(el);
  });
}

function createSessionEl(s) {
  const div = document.createElement('div');
  div.className = 'session-item' + (s.id === currentSessionId ? ' active' : '');
  const title = s.title || s.summary || 'Sans titre';
  const preview = (s.preview || s.lastMessage || '').slice(0, 80);
  const time = formatTime(s.time?.updated || s.updatedAt || s.time?.created || s.createdAt);
  div.innerHTML = `
    <div class="title" title="${escapeHtml(title)}">${escapeHtml(title.slice(0,60))}</div>
    ${preview ? `<div class="preview">${escapeHtml(preview)}</div>` : ''}
    <div class="meta"><span>${escapeHtml(time)}</span><span>${escapeHtml(s.id.slice(0,8))}</span></div>
    <div class="actions">
      <button data-act="rename">Renommer</button>
      <button data-act="fork">Fork</button>
      <button data-act="delete">Supprimer</button>
    </div>
  `;
  div.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    openSession(s.id);
  });
  div.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'delete') await deleteSession(s.id);
      if (act === 'rename') {
        const nt = prompt('Nouveau titre', s.title || '');
        if (nt !== null) await renameSession(s.id, nt);
      }
      if (act === 'fork') await forkSession(s.id);
    });
  });
  return div;
}

function formatTime(v) {
  if (!v) return '';
  const d = new Date(v);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
  return d.toLocaleDateString('fr-FR', {day:'2-digit', month:'short'});
}

function escapeHtml(s) {
  return String(s||'').replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// --- Messages ---
async function openSession(id) {
  currentSessionId = id;
  sessionListToday.querySelectorAll('.session-item').forEach(el=>el.classList.remove('active'));
  sessionListOlder.querySelectorAll('.session-item').forEach(el=>el.classList.remove('active'));
  renderSessions();
  // highlight active quickly
  $$('.session-item').forEach(el=>{
    if (el.textContent.includes(id.slice(0,8))) el.classList.add('active');
  });
  const s = sessions.find(x=> x.id===id);
  sessionTitleEl.textContent = s?.title || 'Conversation';
  updateSessionModelBadge();
  messagesEl.innerHTML = '<div class="status-bar"><span class="spinner"></span> Chargement...</div>';
  emptyState.style.display = 'none';
  try {
    const data = await apiFetch(`/session/${id}/message`);
    // data is array of {info, parts}
    const msgs = Array.isArray(data) ? data : (data.messages || []);
    messagesCache.set(id, msgs);
    renderMessages(msgs);
  } catch (e) {
    messagesEl.innerHTML = `<div style="padding:20px;color:#ff7a7a;font-size:13px;">Erreur chargement: ${escapeHtml(e.message)}</div>`;
  }
}

function renderMessages(msgs) {
  messagesEl.innerHTML = '';
  if (!msgs || msgs.length === 0) {
    messagesEl.appendChild(emptyState);
    emptyState.style.display = 'flex';
    return;
  }
  emptyState.style.display = 'none';
  msgs.forEach(m => {
    const info = m.info || m;
    const parts = m.parts || [];
    const role = info.role || info.type || 'assistant';
    // system messages
    if (role === 'system') {
      // skip or show subtle
      return;
    }
    const row = document.createElement('div');
    row.className = `message-row ${role === 'user' ? 'user' : 'assistant'}`;
    const avatar = document.createElement('div');
    avatar.className = `avatar ${role === 'user' ? 'user' : 'assistant'}`;
    avatar.textContent = role === 'user' ? '◉' : '✦';
    const bubble = document.createElement('div');
    bubble.className = 'bubble ' + (role === 'user' ? 'user' : 'assistant');
    // build content from parts
    let html = '';
    let hasText = false;
    parts.forEach(p => {
      const t = p.type || p.part_type || '';
      if (t === 'text' || t === 'reasoning' || p.text) {
        const text = p.text || p.content || '';
        if (!text) return;
        hasText = true;
        if (t === 'reasoning') {
          html += `<div class="part-reasoning">${renderMarkdown(text)}</div>`;
        } else {
          html += renderMarkdown(text);
        }
      } else if (t === 'tool' || t === 'tool_use' || p.tool) {
        const name = p.tool || p.name || p.toolID || 'outil';
        const out = p.output || p.result || p.content || '';
        html += `<div class="tool-card"><div class="tool-head">🔧 ${escapeHtml(name)} <span style="margin-left:auto;font-weight:400;opacity:.6;">${escapeHtml(p.state || '')}</span></div>${out ? `<div class="tool-body">${escapeHtml(String(out).slice(0,1200))}</div>`:''}</div>`;
      } else if (t === 'file' || p.filename) {
        html += `<div class="tool-card"><div class="tool-head">📄 ${escapeHtml(p.filename || p.path || 'fichier')}</div></div>`;
      } else if (p.type === 'system') {
        html += `<div class="part-system">${escapeHtml(p.text||'')}</div>`;
      } else {
        // fallback: try to show text
        if (p.text) html += renderMarkdown(p.text);
        else if (typeof p === 'string') html += renderMarkdown(p);
      }
    });
    if (!hasText && !html) {
      // try info.content
      if (info.content) html = renderMarkdown(String(info.content));
      else html = '<span style="color:var(--text-faint);font-size:12px;">(message vide)</span>';
    }
    bubble.innerHTML = html + `<div class="meta"><span>${escapeHtml(role)}</span><span>${escapeHtml(formatTime(info.time?.created || info.createdAt))}</span></div>`;
    // highlight code
    bubble.querySelectorAll('pre code').forEach(block => {
      if (window.hljs) hljs.highlightElement(block);
    });
    if (role === 'user') {
      row.appendChild(bubble);
      row.appendChild(avatar);
    } else {
      row.appendChild(avatar);
      row.appendChild(bubble);
    }
    messagesEl.appendChild(row);
  });
  // auto highlight
  messagesEl.querySelectorAll('pre code').forEach(b=> { try{ hljs.highlightElement(b);}catch{}});
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMarkdown(md) {
  try {
    const raw = window.marked ? marked.parse(md) : `<p>${escapeHtml(md)}</p>`;
    return window.DOMPurify ? DOMPurify.sanitize(raw) : raw;
  } catch {
    return `<p>${escapeHtml(md)}</p>`;
  }
}

// --- Create / Send ---
async function createSession(title) {
  const s = await apiFetch('/session', { method: 'POST', body: JSON.stringify({ title: title || 'Nouvelle conversation' }) });
  const session = s.session || s;
  sessions.unshift(session);
  renderSessions();
  await openSession(session.id);
  return session;
}

async function ensureSession() {
  if (currentSessionId) return currentSessionId;
  const s = await createSession('Nouvelle conversation');
  return s.id;
}

async function sendPrompt() {
  const text = promptInput.value.trim();
  if (!text || isStreaming) return;
  const modelVal = modelSelect.value;
  let model = undefined;
  if (modelVal) {
    try { model = JSON.parse(modelVal); } catch {}
  }
  const agent = agentSelect.value || 'build';
  promptInput.value = '';
  adjustTextarea();
  sendBtn.disabled = true;
  setStreaming(true, 'Envoi…');
  try {
    const sid = await ensureSession();
    // optimistic render user message
    const cur = messagesCache.get(sid) || [];
    cur.push({ info: { role: 'user', time: { created: new Date().toISOString() } }, parts: [{ type: 'text', text }] });
    messagesCache.set(sid, cur);
    renderMessages(cur);
    // update session title preview if first message
    const sess = sessions.find(x=> x.id===sid);
    if (sess && (!sess.title || sess.title==='Nouvelle conversation')) {
      sess.title = text.slice(0, 50);
      renderSessions();
      sessionTitleEl.textContent = sess.title;
    }

    // Try async then SSE, fallback to sync
    // We attempt prompt_async first for streaming
    try {
      // Prefer synchronous for simplicity if SSE not connected
      if (eventSource && eventSource.readyState === 1) {
        await apiFetch(`/session/${sid}/prompt_async`, {
          method: 'POST',
          body: JSON.stringify({
            parts: [{ type: 'text', text }],
            model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
            agent
          })
        });
        // streaming will be handled via SSE, we poll messages
        pollMessages(sid, 60000);
      } else {
        const resp = await apiFetch(`/session/${sid}/message`, {
          method: 'POST',
          body: JSON.stringify({
            parts: [{ type: 'text', text }],
            model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
            agent
          })
        });
        // resp is single message or {info,parts}
        await refreshMessages(sid);
      }
    } catch (e) {
      // fallback sync already failed? show error
      throw e;
    }
  } catch (e) {
    console.error(e);
    alert('Erreur envoi: ' + e.message);
  } finally {
    setStreaming(false);
    sendBtn.disabled = false;
    promptInput.focus();
  }
}

async function refreshMessages(sid) {
  try {
    const data = await apiFetch(`/session/${sid}/message`);
    const msgs = Array.isArray(data) ? data : [];
    messagesCache.set(sid, msgs);
    renderMessages(msgs);
  } catch {}
}

function pollMessages(sid, timeoutMs) {
  let elapsed = 0;
  const interval = setInterval(async () => {
    elapsed += 700;
    await refreshMessages(sid);
    // check if still streaming by checking last message role
    const msgs = messagesCache.get(sid) || [];
    const last = msgs[msgs.length-1];
    // naive: if last role is assistant and not streaming, stop after 2 polls stable
    if (elapsed > timeoutMs) clearInterval(interval);
    // we also listen to SSE to stop
  }, 700);
  // auto clear when SSE says done
  const stop = () => clearInterval(interval);
  // will be cleared by setStreaming(false) via SSE
  window._pollStop = stop;
}

function setStreaming(on, text) {
  isStreaming = on;
  if (on) {
    statusBar.classList.remove('hidden');
    statusText.textContent = text || 'OpenCode réfléchit…';
    todoProgress.textContent = '';
    // poll todo
    startTodoPoll();
  } else {
    statusBar.classList.add('hidden');
    stopTodoPoll();
    if (window._pollStop) { try{window._pollStop();}catch{} }
  }
}

let todoTimer = null;
function startTodoPoll() {
  stopTodoPoll();
  if (!currentSessionId) return;
  const tick = async () => {
    try {
      const todos = await apiFetch(`/session/${currentSessionId}/todo`).catch(()=>null);
      if (Array.isArray(todos) && todos.length) {
        const done = todos.filter(t=> t.status==='completed').length;
        todoProgress.textContent = `${done}/${todos.length} tâches`;
        const cur = todos.find(t=> t.status==='in_progress');
        if (cur) statusText.textContent = cur.content || 'En cours…';
      }
      const status = await apiFetch(`/session/${currentSessionId}`).catch(()=>null);
      if (status && status.status) {
        // could contain status
      }
    } catch {}
  };
  tick();
  todoTimer = setInterval(tick, 1200);
}
function stopTodoPoll(){ if(todoTimer){ clearInterval(todoTimer); todoTimer=null; } }

// --- SSE ---
function connectSSE() {
  if (eventSource) { try{ eventSource.close(); }catch{} }
  try {
    eventSource = new EventSource(apiUrl('/event'));
    eventSource.onopen = () => {
      setServerStatus('connected','Connecté');
      serverInfo.textContent = `✓ ${serverUrl} • live`;
    };
    eventSource.onerror = () => {
      // EventSource auto reconnect
      setServerStatus('connecting','Reconnexion…');
    };
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        handleEvent(data);
      } catch {
        // raw
      }
    };
    // listen to all events (some servers send event: message.updated etc)
    eventSource.addEventListener('message.updated', (e)=> {
      try { handleEvent(JSON.parse(e.data)); } catch {}
    });
    eventSource.addEventListener('session.updated', (e)=> {
      try { handleEvent(JSON.parse(e.data)); } catch {}
    });
    eventSource.addEventListener('server.connected', ()=> {
      setServerStatus('connected','Connecté');
    });
  } catch (e) {
    console.warn('SSE failed', e);
  }
}

function handleEvent(ev) {
  // ev example: {type:"message.updated", properties:{sessionID, info, parts}}
  // we just refresh current session if matches
  const sid = ev.sessionID || ev.sessionId || ev.properties?.sessionID || ev.properties?.sessionId || ev.payload?.sessionID;
  if (sid && sid === currentSessionId) {
    refreshMessages(sid);
    // if event indicates completion, stop streaming after delay
    if (ev.type && (ev.type.includes('message') || ev.type.includes('session'))) {
      // check if last message is final
      // we debounce
      setTimeout(()=> setStreaming(false), 900);
    }
  }
  // also if type is session.created/updated, reload list
  if (ev.type && ev.type.startsWith('session')) {
    loadSessions();
  }
}

// --- Session actions ---
async function deleteSession(id) {
  if (!confirm('Supprimer cette conversation ?')) return;
  await apiFetch(`/session/${id}`, { method: 'DELETE' }).catch(()=>{});
  sessions = sessions.filter(s=> s.id!==id);
  messagesCache.delete(id);
  if (currentSessionId===id) {
    currentSessionId=null;
    messagesEl.innerHTML='';
    messagesEl.appendChild(emptyState);
    emptyState.style.display='flex';
    sessionTitleEl.textContent='Nouvelle conversation';
  }
  renderSessions();
}
async function renameSession(id, title) {
  await apiFetch(`/session/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }).catch(()=>{});
  const s = sessions.find(x=>x.id===id);
  if (s) s.title = title;
  renderSessions();
  if (id===currentSessionId) sessionTitleEl.textContent = title;
}
async function forkSession(id) {
  const res = await apiFetch(`/session/${id}/fork`, { method: 'POST', body: JSON.stringify({}) });
  const sess = res.session || res;
  sessions.unshift(sess);
  renderSessions();
  openSession(sess.id);
}

// --- UI wiring ---
function adjustTextarea() {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 160) + 'px';
}

promptInput.addEventListener('input', adjustTextarea);
promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendPrompt();
  }
});
sendBtn.addEventListener('click', sendPrompt);

newChatBtn.addEventListener('click', async () => {
  currentSessionId = null;
  sessionTitleEl.textContent = 'Nouvelle conversation';
  messagesEl.innerHTML = '';
  messagesEl.appendChild(emptyState);
  emptyState.style.display = 'flex';
  promptInput.focus();
  // optional create session immediately? lazy
});

searchInput.addEventListener('input', renderSessions);
modelSelect.addEventListener('change', () => {
  localStorage.setItem('opencode:model', modelSelect.value);
  updateSessionModelBadge();
});

serverSaveBtn.addEventListener('click', async () => {
  const url = serverUrlInput.value.trim();
  if (!url) return;
  serverUrl = url;
  localStorage.setItem('opencode:serverUrl', serverUrl);
  if (window.opencodeAPI) await window.opencodeAPI.setServerConfig({ port: new URL(serverUrl).port, hostname: new URL(serverUrl).hostname });
  const ok = await checkServer();
  if (ok) { await loadAll(); connectSSE(); }
});

$('#reconnectBtn').addEventListener('click', async () => {
  setServerStatus('connecting','Connexion…');
  if (window.opencodeAPI) await window.opencodeAPI.restartServer();
  const ok = await checkServer();
  if (ok) { await loadAll(); connectSSE(); }
});

$('#pickFolderBtn').addEventListener('click', async () => {
  if (window.opencodeAPI) {
    const p = await window.opencodeAPI.selectFolder();
    if (p) {
      projectPathEl.textContent = p;
      projectPathEl.title = p;
      // Note: opencode server workdir is process cwd; changing folder would require restart with new cwd
      // For now just display
    }
  }
});

$('#settingsBtn').addEventListener('click', () => $('#settingsDialog').showModal());
$('#settingsCancel').addEventListener('click', () => $('#settingsDialog').close());
$('#settingsSave').addEventListener('click', async () => {
  const url = $('#settingsUrl').value.trim();
  if (url) {
    serverUrl = url;
    serverUrlInput.value = url;
    localStorage.setItem('opencode:serverUrl', url);
  }
  $('#settingsDialog').close();
  const ok = await checkServer();
  if (ok) { await loadAll(); connectSSE(); }
});

$('#helpBtn').addEventListener('click', () => {
  if (window.opencodeAPI) window.opencodeAPI.openExternal('https://opencode.ai/docs');
  else window.open('https://opencode.ai/docs','_blank');
});

$('#shareBtn').addEventListener('click', async () => {
  if (!currentSessionId) return alert('Aucune session à partager');
  try {
    const res = await apiFetch(`/session/${currentSessionId}/share`, { method: 'POST' });
    const url = res.shareUrl || res.url || JSON.stringify(res);
    prompt('Lien de partage', url);
  } catch (e) { alert('Erreur partage: '+ e.message); }
});

$('#deleteBtn').addEventListener('click', async () => {
  if (!currentSessionId) return;
  await deleteSession(currentSessionId);
});

$('#sidebarToggle').addEventListener('click', () => {
  $('#sidebar').classList.toggle('collapsed');
});
$('#mobileMenuBtn').addEventListener('click', () => {
  $('#sidebar').classList.toggle('collapsed');
});

$$('.suggestion').forEach(btn => {
  btn.addEventListener('click', () => {
    promptInput.value = btn.dataset.prompt;
    adjustTextarea();
    sendPrompt();
  });
});

// --- Auto-update via GitHub Releases ---
// Une seule release "latest" (rolling) : à chaque push sur main, le workflow
// GitHub rebuild le portable .exe et met à jour cette release.
// L'app compare la date du build embarqué avec celle de l'asset distant.
const UPDATE_REPO = 'alphasiix/OpenCode-Chat';
const UPDATE_TAG = 'latest';
let pendingUpdateUrl = null;
let pendingUpdateKey = null;

function normalizeVersion(v) {
  return String(v || '').trim().replace(/^v/i, '');
}

function isNewerVersion(latest, current) {
  const a = normalizeVersion(latest).split('.').map(x => parseInt(x, 10) || 0);
  const b = normalizeVersion(current).split('.').map(x => parseInt(x, 10) || 0);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function isVersionTag(t) {
  return /^v?\d+(\.\d+)*$/i.test(String(t || '').trim());
}

async function getCurrentVersion() {
  try {
    if (window.opencodeAPI && window.opencodeAPI.getAppVersion) {
      return await window.opencodeAPI.getAppVersion();
    }
  } catch {}
  return '1.0.0';
}

// Infos du build embarqué (généré par scripts/write-build-info.js au build)
async function getBuildInfo() {
  try {
    if (window.opencodeAPI && window.opencodeAPI.getBuildInfo) {
      const info = await window.opencodeAPI.getBuildInfo();
      if (info) return info;
    }
  } catch {}
  try {
    const res = await fetch('build-info.json', { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

function pickExeAsset(release) {
  const assets = (release && release.assets) || [];
  const exes = assets.filter(a => /\.exe$/i.test(a.name || ''));
  if (!exes.length) return null;
  // Préfère le portable, sinon le premier .exe
  return exes.find(a => /portable/i.test(a.name)) || exes[0];
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso || ''; }
}

function showUpdatePopup(release, asset, current, localDate) {
  const title = (release.name || release.tag_name || 'Nouvelle version').trim();
  const when = asset.updated_at || asset.created_at || release.published_at;
  $('#updateText').textContent = `${title} disponible (${fmtDate(when)}) — tu as v${normalizeVersion(current)}`;
  const notes = (release.body || '').trim().slice(0, 800);
  $('#updateNotes').textContent = notes;
  $('#updateNotes').style.display = notes ? 'block' : 'none';
  pendingUpdateUrl = (asset && asset.browser_download_url) || release.html_url;
  pendingUpdateKey = (asset && (asset.updated_at + ':' + asset.size)) || release.tag_name;
  const dlg = $('#updateDialog');
  if (dlg && !dlg.open) dlg.showModal();
}

async function checkForUpdates(manual = false) {
  let current = '1.0.0';
  try {
    current = await getCurrentVersion();
  } catch {}
  const local = await getBuildInfo();
  const label = $('#appVersionLabel');
  if (label) {
    const parts = ['v' + normalizeVersion(local && local.version ? local.version : current)];
    if (local && local.commit && local.commit !== 'dev') parts.push(local.commit);
    label.textContent = parts.join(' • ');
    label.title = local && local.date ? 'Build du ' + fmtDate(local.date) : '';
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/tags/${UPDATE_TAG}`, {
      headers: { 'Accept': 'application/vnd.github+json' }
    });
    if (res.status === 404) {
      if (manual) alert('Aucune release publiée pour le moment.');
      return;
    }
    if (!res.ok) {
      if (manual) alert('Vérification impossible (réseau/GitHub).');
      return;
    }
    const release = await res.json();
    const exe = pickExeAsset(release);
    if (!exe) {
      if (manual) alert('Release trouvée mais sans .exe.');
      return;
    }
    // 1) Cas versionné (tag v1.0.1 > version locale) — couvre aussi les vieilles releases
    const tag = release.tag_name || '';
    const semverNewer = isVersionTag(tag) && isNewerVersion(tag, current);
    // 2) Cas rolling : l'asset distant est plus récent que le build embarqué
    const remoteTime = new Date(exe.updated_at || exe.created_at || release.published_at || 0).getTime() || 0;
    const localTime = (local && local.date) ? new Date(local.date).getTime() : 0;
    const rollingNewer = localTime > 0 && remoteTime > 0 && (remoteTime - localTime > 60 * 1000);
    // Sans build-info (dev), on ne peut comparer que le semver
    const newer = semverNewer || rollingNewer || (localTime === 0 && semverNewer);
    if (!newer) {
      if (manual) alert(`Tu es à jour (v${normalizeVersion(current)}).`);
      return;
    }
    const skipped = localStorage.getItem('opencode:skipUpdate');
    const key = (exe.updated_at + ':' + exe.size) || tag;
    if (!manual && skipped === key) return;
    showUpdatePopup(release, exe, current, local && local.date);
  } catch (e) {
    if (manual) alert('Vérification impossible : ' + e.message);
  }
}

$('#updateLaterBtn').addEventListener('click', () => {
  try {
    if (pendingUpdateKey) localStorage.setItem('opencode:skipUpdate', pendingUpdateKey);
  } catch {}
  $('#updateDialog').close();
});

$('#updateDownloadBtn').addEventListener('click', () => {
  if (pendingUpdateUrl) {
    if (window.opencodeAPI) window.opencodeAPI.openExternal(pendingUpdateUrl);
    else window.open(pendingUpdateUrl, '_blank');
  }
  $('#updateDialog').close();
});

$('#checkUpdateBtn').addEventListener('click', () => checkForUpdates(true));

// restore saved serverUrl
const savedUrl = localStorage.getItem('opencode:serverUrl');
if (savedUrl) { serverUrl = savedUrl; serverUrlInput.value = savedUrl; }

// Init
initServer();
// Vérification update au démarrage (+ toutes les 6h)
getCurrentVersion().then(v => {
  const label = $('#appVersionLabel');
  if (label) label.textContent = 'v' + normalizeVersion(v);
});
setTimeout(() => checkForUpdates(false), 4000);
setInterval(() => checkForUpdates(false), 6 * 60 * 60 * 1000);

// Handle drag & drop images (basic)
messagesEl.addEventListener('dragover', e=> e.preventDefault());
messagesEl.addEventListener('drop', e=> {
  e.preventDefault();
  // TODO: implement image upload as parts type image
  alert('Glisser-déposer d\'images : bientôt disponible — l\'API opencode supporte les pièces jointes image.');
});
$('#attachBtn').addEventListener('click', ()=> alert('Ajout d\'image : glisse une image dans la fenêtre ou colle depuis le presse-papier (à venir).'));

// Expose for debug
window._app = { apiFetch, loadSessions, openSession };

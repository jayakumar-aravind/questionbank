// ===== CONSTANTS =====
const DEFAULT_TOPICS = [
  "Number", "Algebra", "Ratio & Proportion", "Geometry & Measures",
  "Statistics", "Probability", "Fractions & Decimals", "Percentages",
  "Equations & Inequalities", "Sequences", "Graphs & Coordinates", "Shape & Space"
];

const PATTERNS = [
  "Applying a Formula", "Multi-step Reasoning", "Interpreting Context",
  "Spotting Errors", "Recall & Retrieval", "Estimation & Checking",
  "Spatial Reasoning", "Data Interpretation", "Proof & Justification"
];

// ===== STATE =====
let topics = [...DEFAULT_TOPICS];
let questions = [];
let selectedIds = new Set();
let currentTab = 'upload';
let modalResolve = null;
let modalSelectedTopic = '';
let firebaseDb = null;
let firebaseFns = null;
let settings = {};

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadLocalQuestions();
  renderConfigBanner();
  populateAllDropdowns();
  renderTopicChips();
  populateSettingsForm();
  updateTotalBadge();
  filterQuestions();

  // Wire up generate tab listeners
  ['gen-topic', 'gen-pattern', 'gen-age', 'gen-count'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', updateGenPreview);
  });

  // Connect Firebase if configured
  if (settings.apiKey && settings.projectId) {
    initFirebase();
  }
});

// ===== SETTINGS =====
function loadSettings() {
  try { settings = JSON.parse(localStorage.getItem('mqb_settings') || '{}'); } catch(e) { settings = {}; }
  const savedTopics = localStorage.getItem('mqb_topics');
  if (savedTopics) { try { topics = JSON.parse(savedTopics); } catch(e) {} }
}

function saveSettingsToLocal() {
  localStorage.setItem('mqb_settings', JSON.stringify(settings));
  localStorage.setItem('mqb_topics', JSON.stringify(topics));
}

window.saveSettings = function() {
  settings.apiKey = document.getElementById('s-apiKey').value.trim();
  settings.authDomain = document.getElementById('s-authDomain').value.trim();
  settings.projectId = document.getElementById('s-projectId').value.trim();
  settings.anthropicKey = document.getElementById('s-anthropicKey').value.trim();
  saveSettingsToLocal();
  renderConfigBanner();
  showToast('Settings saved', 'success');
  if (settings.apiKey && settings.projectId) initFirebase();
};

function populateSettingsForm() {
  const fields = ['apiKey', 'authDomain', 'projectId', 'anthropicKey'];
  fields.forEach(f => {
    const el = document.getElementById(`s-${f}`);
    if (el) el.value = settings[f] || '';
  });
}

window.addTopicFromSettings = function() {
  const inp = document.getElementById('new-topic-input');
  const val = inp.value.trim();
  if (!val) return;
  if (topics.includes(val)) { showToast('Topic already exists'); return; }
  topics.push(val);
  saveSettingsToLocal();
  renderTopicChips();
  populateAllDropdowns();
  inp.value = '';
  showToast(`Topic "${val}" added`, 'success');
};

window.clearAllData = function() {
  if (!confirm('This will clear all locally stored questions and settings. Are you sure?')) return;
  localStorage.clear();
  questions = [];
  settings = {};
  topics = [...DEFAULT_TOPICS];
  updateUI();
  populateSettingsForm();
  renderTopicChips();
  showToast('All local data cleared');
};

function renderTopicChips() {
  const el = document.getElementById('topic-chips');
  if (!el) return;
  el.innerHTML = topics.map(t =>
    `<span class="tag tag-topic" style="cursor:default">${t}</span>`
  ).join('');
}

// ===== FIREBASE =====
async function initFirebase() {
  try {
    const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
    const { getFirestore, collection, getDocs, addDoc, deleteDoc, doc, query, orderBy } =
      await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');

    const config = {
      apiKey: settings.apiKey,
      authDomain: settings.authDomain,
      projectId: settings.projectId
    };
    const app = getApps().length ? getApps()[0] : initializeApp(config);
    firebaseDb = getFirestore(app);
    firebaseFns = { collection, getDocs, addDoc, deleteDoc, doc, query, orderBy };

    await syncFromFirebase();
    showToast('Connected to Firebase', 'success');
  } catch(e) {
    console.error('Firebase error:', e);
    showToast('Firebase connection failed — using local storage', 'error');
  }
}

async function syncFromFirebase() {
  if (!firebaseDb || !firebaseFns) return;
  try {
    const { collection, getDocs, query, orderBy } = firebaseFns;
    const q = query(collection(firebaseDb, 'questions'), orderBy('dateAdded', 'desc'));
    const snap = await getDocs(q);
    questions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    saveLocalQuestions();
    updateUI();
  } catch(e) {
    console.error('Sync error:', e);
  }
}

async function saveQuestionToFirebase(q) {
  if (!firebaseDb || !firebaseFns) return null;
  try {
    const { collection, addDoc } = firebaseFns;
    const docRef = await addDoc(collection(firebaseDb, 'questions'), q);
    return docRef.id;
  } catch(e) {
    console.error('Save error:', e);
    return null;
  }
}

async function deleteQuestionFromFirebase(id) {
  if (!firebaseDb || !firebaseFns) return;
  try {
    const { doc, deleteDoc } = firebaseFns;
    await deleteDoc(doc(firebaseDb, 'questions', id));
  } catch(e) {
    console.error('Delete error:', e);
  }
}

// ===== LOCAL STORAGE =====
function loadLocalQuestions() {
  try {
    const raw = localStorage.getItem('mqb_questions');
    if (raw) questions = JSON.parse(raw);
  } catch(e) { questions = []; }
}

function saveLocalQuestions() {
  localStorage.setItem('mqb_questions', JSON.stringify(questions));
}

// ===== TAB NAVIGATION =====
window.showTab = function(tab) {
  currentTab = tab;
  const tabs = ['upload', 'bank', 'generate', 'settings'];
  tabs.forEach(t => {
    document.getElementById(`tab-${t}`).style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('.nav-btn').forEach((btn, i) => {
    btn.classList.toggle('active', tabs[i] === tab);
  });
  if (tab === 'bank') filterQuestions();
  if (tab === 'generate') updateGenPreview();
  if (tab === 'settings') populateSettingsForm();
};

// ===== CONFIG BANNER =====
function renderConfigBanner() {
  const el = document.getElementById('firebase-config-section');
  if (!el) return;
  const missing = [];
  if (!settings.anthropicKey) missing.push('Anthropic API key');
  if (!settings.projectId) missing.push('Firebase credentials');

  if (missing.length > 0) {
    el.innerHTML = `<div class="config-banner">
      <strong>Setup needed: ${missing.join(' and ')} required</strong>
      <p>Without these, the tool cannot extract questions from uploads${!settings.projectId ? ' and will store data in your browser only' : ''}.</p>
      <button class="btn btn-sm" onclick="showTab('settings')">Go to Settings →</button>
    </div>`;
  } else {
    el.innerHTML = '';
  }
}

// ===== FILE HANDLING =====
window.handleDragOver = function(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.add('drag');
};
window.handleDragLeave = function() {
  document.getElementById('drop-zone').classList.remove('drag');
};
window.handleDrop = function(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('drag');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
};
window.handleFileSelect = function(e) {
  if (e.target.files[0]) processFile(e.target.files[0]);
};

async function processFile(file) {
  const area = document.getElementById('processing-area');
  area.innerHTML = `
    <div class="processing-card">
      <div class="processing-header">
        <div class="spinner"></div>
        <strong>${escapeHtml(file.name)}</strong>
      </div>
      <div class="progress-bar"><div class="progress-fill" id="prog" style="width:5%"></div></div>
      <div class="progress-steps">
        <div class="step active" id="step1"><div class="step-dot"></div>Extracting content from file...</div>
        <div class="step" id="step2"><div class="step-dot"></div>Identifying questions (ignoring student work)</div>
        <div class="step" id="step3"><div class="step-dot"></div>Computing answers &amp; categorising</div>
        <div class="step" id="step4"><div class="step-dot"></div>Saving to question bank</div>
      </div>
    </div>`;

  try {
    setProcessingStep(1, 15);
    const content = await extractContent(file);

    setProcessingStep(2, 40);
    const extracted = await callClaudeAPI(content, file.name);

    if (!extracted || extracted.length === 0) {
      throw new Error('No questions found in this file. Check the file contains readable maths questions.');
    }

    setProcessingStep(3, 70);
    // Handle low-confidence topic assignments
    for (const q of extracted) {
      if (q.topicConfidence < 70) {
        q.topic = await showTopicModal(q);
      }
    }

    setProcessingStep(4, 90);
    let savedCount = 0;
    let skippedCount = 0;
    for (const q of extracted) {
      if (isDuplicate(q.question)) {
        skippedCount++;
        continue;
      }
      const record = {
        question: q.question,
        answer: q.answer,
        topic: q.topic,
        pattern: q.pattern,
        difficulty: q.difficulty,
        ageRange: q.ageRange,
        sourceFile: file.name,
        dateAdded: new Date().toISOString(),
        fingerprint: fingerprint(q.question)
      };
      const firebaseId = await saveQuestionToFirebase(record);
      record.id = firebaseId || `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      questions.unshift(record);
      savedCount++;
    }

    saveLocalQuestions();
    setProgress(100);

    const skipMsg = skippedCount > 0 ? ` (${skippedCount} duplicate${skippedCount > 1 ? 's' : ''} skipped)` : '';
    area.innerHTML = `
      <div class="processing-card success">
        <div class="processing-header">
          <div class="check-circle">
            <svg viewBox="0 0 12 12" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M2 6l3 3 5-5"/>
            </svg>
          </div>
          <strong>${savedCount} question${savedCount !== 1 ? 's' : ''} added from ${escapeHtml(file.name)}${skipMsg}</strong>
          <button class="btn btn-sm btn-primary" style="margin-left:auto" onclick="showTab('bank')">View in bank →</button>
        </div>
      </div>`;

    updateUI();
  } catch(e) {
    area.innerHTML = `
      <div class="processing-card error">
        <div class="processing-header">
          <strong style="color:var(--danger)">Error processing file</strong>
        </div>
        <p style="font-size:13px;color:var(--danger);margin-top:4px">${escapeHtml(e.message)}</p>
        <p style="font-size:12px;color:var(--text-muted);margin-top:6px">Make sure your Anthropic API key is set in Settings.</p>
      </div>`;
  }

  // Reset file input so same file can be re-uploaded
  document.getElementById('file-input').value = '';
}

function setProcessingStep(n, p) {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`step${i}`);
    if (!el) continue;
    if (i < n) el.className = 'step done';
    else if (i === n) el.className = 'step active';
    else el.className = 'step';
  }
  setProgress(p);
}

function setProgress(p) {
  const el = document.getElementById('prog');
  if (el) el.style.width = p + '%';
}

// ===== CONTENT EXTRACTION =====
async function extractContent(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') {
    return await readAsBase64(file);
  }

  if (ext === 'docx') {
    const arrayBuffer = await readAsArrayBuffer(file);
    const result = await mammoth.extractRawText({ arrayBuffer });
    return { type: 'text', data: result.value };
  }

  if (ext === 'pdf') {
    const arrayBuffer = await readAsArrayBuffer(file);
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n';
    }

    // If text is too sparse, it's likely a scanned PDF — render pages in batches under 4MB each
    if (text.replace(/\s/g, '').length < 80) {
      const scale = 1.2;
      const MAX_BYTES = 4 * 1024 * 1024; // 4MB safe limit per API call

      // Render every page to its own canvas
      const pageCanvases = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        pageCanvases.push(canvas);
      }

      // Group pages into batches that fit under 4MB and 7000px tall
      const MAX_HEIGHT = 7000;
      const batches = [];
      let batchCanvases = [];
      let batchBytes = 0;
      let batchHeight = 0;

      for (const canvas of pageCanvases) {
        const bytes = canvas.toDataURL('image/jpeg', 0.82).length * 0.75;
        const wouldExceedSize = batchBytes + bytes > MAX_BYTES;
        const wouldExceedHeight = batchHeight + canvas.height > MAX_HEIGHT;
        if ((wouldExceedSize || wouldExceedHeight) && batchCanvases.length > 0) {
          batches.push(batchCanvases);
          batchCanvases = [];
          batchBytes = 0;
          batchHeight = 0;
        }
        batchCanvases.push(canvas);
        batchBytes += bytes;
        batchHeight += canvas.height;
      }
      if (batchCanvases.length > 0) batches.push(batchCanvases);

      // Stitch each batch into one image
      const images = batches.map(batch => {
        const maxWidth = Math.max(...batch.map(c => c.width));
        const totalHeight = batch.reduce((sum, c) => sum + c.height, 0);
        const stitched = document.createElement('canvas');
        stitched.width = maxWidth;
        stitched.height = totalHeight;
        const ctx = stitched.getContext('2d');
        let y = 0;
        for (const c of batch) { ctx.drawImage(c, 0, y); y += c.height; }
        return { type: 'image', data: stitched.toDataURL('image/jpeg', 0.82).split(',')[1], mimeType: 'image/jpeg' };
      });

      return { type: 'multiImage', images };
    }

    return { type: 'text', data: text };
  }

  throw new Error(`Unsupported file type: .${ext}`);
}

function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve({
      type: 'image',
      data: e.target.result.split(',')[1],
      mimeType: file.type
    });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ===== CLAUDE API =====
async function callClaudeAPI(content, filename) {
  if (!settings.anthropicKey) {
    throw new Error('Anthropic API key not set. Please add it in Settings.');
  }

  const topicList = topics.join(', ');
  const patternList = PATTERNS.join(', ');

  const systemPrompt = `You extract maths questions from UK school worksheets (England National Curriculum). Ignore all student workings, answers, and annotations.

For each question return JSON with:
- question: full text including all parts (a)(b)(c) as one entry
- answer: compute independently, show brief working
- topic: best match from [${topicList}]
- topicConfidence: 0-100
- pattern: best match from [${patternList}] where: "Applying a Formula"=substitute into formula; "Multi-step Reasoning"=chain 2+ operations; "Interpreting Context"=real-world scenario; "Spotting Errors"=find mistake; "Recall & Retrieval"=facts/definitions/recognition; "Estimation & Checking"=approximate/verify; "Spatial Reasoning"=shapes/angles/symmetry; "Data Interpretation"=graphs/tables; "Proof & Justification"=explain why
- difficulty: 1=KS1(ages 5-7) 2=KS2(ages 7-11) 3=KS3(ages 11-14) 4=GCSE Foundation 5=GCSE Higher
- ageRange: "Primary" if difficulty 1-2, "Secondary" if difficulty 3-5

TOPIC RULES: Base topic on mathematical content not question style. Square numbers/primes/number properties with no algebra = "Number" not "Algebra". "Proof & Justification" is a pattern not a topic.

AGE RANGE RULES: The sqrt symbol alone does NOT mean Secondary. If answerable using basic square number facts (sqrt(81)=9) it is Primary. "Show with examples" = Primary. "Prove algebraically for all cases" = Secondary. Doubling/halving/square numbers within 100/times tables = always Primary.

Respond ONLY with a valid JSON array, no markdown.`;

  // Helper to call API for a single content block
  async function callOnce(msgContent) {
    const response = await fetch('https://anthropic-proxy.jayakumar-aravind.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: msgContent }]
      })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`API error ${response.status}: ${err.error?.message || 'Unknown error'}`);
    }
    const data = await response.json();
    const text = data.content?.find(b => b.type === 'text')?.text || '[]';
    const clean = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(clean);
  }

  // For multi-image batches, call API per batch and merge results
  if (content.type === 'multiImage') {
    const allQuestions = [];
    for (const img of content.images) {
      const msgContent = [
        { type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } },
        { type: 'text', text: 'Extract all maths questions from this worksheet page. Ignore all student workings and answers.' }
      ];
      const batch = await callOnce(msgContent);
      allQuestions.push(...batch);
    }
    return allQuestions;
  }

  let msgContent;
  if (content.type === 'image') {
    msgContent = [
      { type: 'image', source: { type: 'base64', media_type: content.mimeType, data: content.data } },
      { type: 'text', text: 'Extract all maths questions from this worksheet. Ignore all student workings and answers.' }
    ];
  } else {
    msgContent = content.data;
  }

  try {
    return await callOnce(msgContent);
  } catch(e) {
    throw new Error('AI returned invalid data. Please try again.');
  }
}

// ===== TOPIC CONFIRMATION MODAL =====
function showTopicModal(q) {
  return new Promise(resolve => {
    modalResolve = resolve;
    modalSelectedTopic = q.topic;

    document.getElementById('modal-q-preview').textContent =
      q.question.length > 200 ? q.question.substring(0, 200) + '…' : q.question;

    document.getElementById('modal-ai-suggestion').innerHTML = `
      <div class="ai-suggestion" onclick="selectModalTopic('${escapeHtml(q.topic)}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
        </svg>
        <span style="font-size:13px"><strong>AI suggestion:</strong> ${escapeHtml(q.topic)}</span>
        <span class="conf">${q.topicConfidence}% match</span>
      </div>`;

    const grid = document.getElementById('modal-topics-grid');
    grid.innerHTML = topics.map(t =>
      `<div class="topic-opt ${t === q.topic ? 'selected' : ''}" onclick="selectModalTopic('${escapeHtml(t)}')">${escapeHtml(t)}</div>`
    ).join('');

    document.getElementById('modal-new-topic').value = '';
    document.getElementById('topic-modal').style.display = 'flex';
  });
}

window.selectModalTopic = function(t) {
  modalSelectedTopic = t;
  document.querySelectorAll('.topic-opt').forEach(el => {
    el.classList.toggle('selected', el.textContent.trim() === t);
  });
};

window.confirmNewTopic = function() {
  const val = document.getElementById('modal-new-topic').value.trim();
  if (!val) return;
  if (!topics.includes(val)) {
    topics.push(val);
    saveSettingsToLocal();
    const grid = document.getElementById('modal-topics-grid');
    const el = document.createElement('div');
    el.className = 'topic-opt selected';
    el.textContent = val;
    el.onclick = () => window.selectModalTopic(val);
    grid.appendChild(el);
    document.querySelectorAll('.topic-opt').forEach(e =>
      e.classList.toggle('selected', e.textContent.trim() === val)
    );
  }
  window.selectModalTopic(val);
  document.getElementById('modal-new-topic').value = '';
};

window.confirmTopicChoice = function() {
  document.getElementById('topic-modal').style.display = 'none';
  if (modalResolve) {
    modalResolve(modalSelectedTopic);
    modalResolve = null;
  }
};

// ===== QUESTION BANK =====
function populateAllDropdowns() {
  const dropdowns = [
    { id: 'filter-topic', prefix: 'All topics', items: topics },
    { id: 'gen-topic', prefix: 'Any topic', items: topics },
    { id: 'filter-pattern', prefix: 'All patterns', items: PATTERNS },
    { id: 'gen-pattern', prefix: 'Any pattern', items: PATTERNS },
  ];
  dropdowns.forEach(({ id, prefix, items }) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">${prefix}</option>` +
      items.map(item => `<option ${item === cur ? 'selected' : ''}>${item}</option>`).join('');
  });
}

window.filterQuestions = function() {
  const search = (document.getElementById('search-input')?.value || '').toLowerCase();
  const topic = document.getElementById('filter-topic')?.value || '';
  const pattern = document.getElementById('filter-pattern')?.value || '';
  const diff = document.getElementById('filter-diff')?.value || '';
  const age = document.getElementById('filter-age')?.value || '';

  const filtered = questions.filter(q => {
    if (search && !(q.question?.toLowerCase().includes(search) ||
        q.topic?.toLowerCase().includes(search) ||
        q.pattern?.toLowerCase().includes(search))) return false;
    if (topic && q.topic !== topic) return false;
    if (pattern && q.pattern !== pattern) return false;
    if (diff && String(q.difficulty) !== diff) return false;
    if (age && q.ageRange !== age) return false;
    return true;
  });

  const info = document.getElementById('results-info');
  if (info) info.textContent = `${filtered.length} of ${questions.length} questions`;

  renderQuestions(filtered);
  renderSelectionBar();
};

function renderQuestions(list) {
  const grid = document.getElementById('questions-grid');
  if (!grid) return;

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <h3>${questions.length === 0 ? 'No questions yet' : 'No matching questions'}</h3>
      <p>${questions.length === 0
        ? 'Upload a maths worksheet to get started.'
        : 'Try adjusting your search or filters.'}</p>
    </div>`;
    return;
  }

  grid.innerHTML = list.map(q => `
    <div class="q-card ${selectedIds.has(q.id) ? 'selected' : ''}" id="qcard-${q.id}">
      <div class="q-card-header">
        <input type="checkbox" class="q-checkbox" ${selectedIds.has(q.id) ? 'checked' : ''}
          onchange="toggleSelect('${q.id}', this.checked)">
        <div class="q-text">${escapeHtml(q.question)}</div>
        <div class="diff-dots">
          ${[1,2,3,4,5].map(n =>
            `<div class="diff-dot ${n <= q.difficulty ? 'filled' : ''}"></div>`
          ).join('')}
        </div>
      </div>
      <div class="q-meta">
        <span class="tag tag-topic">${escapeHtml(q.topic || '—')}</span>
        <span class="tag tag-pattern">${escapeHtml(q.pattern || '—')}</span>
        <span class="tag tag-age">${escapeHtml(q.ageRange || '—')}</span>
        <span class="tag tag-source">${escapeHtml(q.sourceFile || 'Manual')}</span>
      </div>
      <div class="q-answer"><strong>Answer:</strong> ${escapeHtml(q.answer || '—')}</div>
      <div class="q-actions">
        <button class="link-btn" onclick="toggleAnswer('qcard-${q.id}')">Show / hide answer</button>
        <button class="delete-btn" onclick="deleteQuestion('${q.id}')">Delete</button>
      </div>
    </div>`).join('');
}

function renderSelectionBar() {
  const bar = document.getElementById('selection-bar-container');
  if (!bar) return;
  const count = selectedIds.size;
  if (count > 0) {
    bar.innerHTML = `<div class="selection-bar">
      <span>${count} question${count > 1 ? 's' : ''} selected</span>
      <div class="sb-actions">
        <button class="sb-btn" onclick="showTab('generate')">Generate sheet from selection ↗</button>
        <button class="sb-btn" onclick="clearSelection()">Clear selection</button>
      </div>
    </div>`;
  } else {
    bar.innerHTML = '';
  }
}

window.toggleAnswer = function(id) {
  document.getElementById(id)?.classList.toggle('show-answer');
};

window.toggleSelect = function(id, checked) {
  if (checked) selectedIds.add(id); else selectedIds.delete(id);
  filterQuestions();
};

window.clearSelection = function() {
  selectedIds.clear();
  filterQuestions();
};

window.deleteQuestion = async function(id) {
  if (!confirm('Delete this question from the bank?')) return;
  await deleteQuestionFromFirebase(id);
  questions = questions.filter(q => q.id !== id);
  selectedIds.delete(id);
  saveLocalQuestions();
  updateUI();
  showToast('Question deleted');
};

// ===== GENERATE SHEET =====
function getMatchingQuestions() {
  const topic = document.getElementById('gen-topic')?.value || '';
  const pattern = document.getElementById('gen-pattern')?.value || '';
  const diff = parseInt(document.getElementById('gen-diff')?.value || '3');
  const age = document.getElementById('gen-age')?.value || '';
  const count = parseInt(document.getElementById('gen-count')?.value || '10');

  return questions.filter(q => {
    if (topic && q.topic !== topic) return false;
    if (pattern && q.pattern !== pattern) return false;
    if (Math.abs((q.difficulty || 3) - diff) > 1) return false;
    if (age && q.ageRange !== age) return false;
    return true;
  }).slice(0, count);
}

window.updateGenPreview = function() {
  const filtered = getMatchingQuestions();
  const topic = document.getElementById('gen-topic')?.value || 'Mixed';
  const diff = document.getElementById('gen-diff')?.value || '3';
  const age = document.getElementById('gen-age')?.value || 'All';

  const statsEl = document.getElementById('gen-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-card"><div class="sv">${filtered.length}</div><div class="sl">Questions found</div></div>
      <div class="stat-card"><div class="sv" style="font-size:14px">${topic}</div><div class="sl">Topic</div></div>
      <div class="stat-card"><div class="sv">${diff}</div><div class="sl">Difficulty</div></div>
      <div class="stat-card"><div class="sv" style="font-size:14px">${age}</div><div class="sl">Age range</div></div>`;
  }

  const list = document.getElementById('gen-q-list');
  if (!list) return filtered;

  if (filtered.length === 0) {
    list.innerHTML = `<p class="no-match">No questions match these filters. Upload more worksheets or adjust the criteria.</p>`;
  } else {
    list.innerHTML = filtered.map((q, i) => `
      <div class="gen-q-item">
        <span class="gen-q-num">${i + 1}.</span>
        <span>${escapeHtml(q.question.length > 140 ? q.question.substring(0, 140) + '…' : q.question)}</span>
      </div>`).join('');
  }
  return filtered;
};

window.exportPDF = function() {
  const qs = getMatchingQuestions();
  if (qs.length === 0) { showToast('No questions to export'); return; }

  const title = document.getElementById('gen-title')?.value || 'Maths Practice Sheet';
  const topic = document.getElementById('gen-topic')?.value || 'Mixed Topics';
  const diff = document.getElementById('gen-diff')?.value || '3';
  const age = document.getElementById('gen-age')?.value || 'All ages';
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const questionsHTML = qs.map((q, i) => `
    <div class="question">
      <div class="q-header">
        <span class="q-number">Question ${i + 1}</span>
        <span class="q-diff">Difficulty: ${q.difficulty}/5</span>
      </div>
      <div class="q-text">${q.question.replace(/\n/g, '<br>')}</div>
      <div class="workspace"></div>
    </div>`).join('');

  const answersHTML = qs.map((q, i) => `
    <div class="answer-row">
      <strong>Q${i + 1}:</strong> ${q.answer.replace(/\n/g, '<br>')}
    </div>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; background: #fff; }
  .page { max-width: 740px; margin: 0 auto; padding: 40px 48px; }
  h1 { font-size: 24px; font-weight: bold; margin-bottom: 4px; letter-spacing: -0.02em; }
  .meta { font-size: 12px; color: #666; margin-bottom: 6px; }
  .divider { border: none; border-top: 2px solid #111; margin: 16px 0 28px; }
  .question { margin-bottom: 32px; page-break-inside: avoid; }
  .q-header { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .q-number { font-size: 13px; font-weight: bold; font-family: system-ui, sans-serif; }
  .q-diff { font-size: 11px; color: #888; font-family: system-ui, sans-serif; }
  .q-text { font-size: 14px; line-height: 1.75; margin-bottom: 10px; }
  .workspace { border-bottom: 0.5px solid #ccc; height: 70px; }
  .answer-section { margin-top: 48px; page-break-before: always; }
  .answer-section h2 { font-size: 16px; font-weight: bold; margin-bottom: 12px; font-family: system-ui, sans-serif; }
  .answer-row { font-size: 13px; line-height: 1.6; margin-bottom: 8px; font-family: system-ui, sans-serif; }
  @media print {
    body { margin: 0; }
    .page { padding: 24px 32px; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
<div class="page">
  <p class="no-print" style="font-family:system-ui;font-size:12px;color:#666;margin-bottom:16px;padding:10px;background:#f5f5f3;border-radius:6px">
    Press <strong>Ctrl+P</strong> (or Cmd+P on Mac) to print or save as PDF. Select "Save as PDF" as the printer.
  </p>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">Topic: ${escapeHtml(topic)} &nbsp;·&nbsp; Difficulty: ${diff}/5 &nbsp;·&nbsp; Age: ${escapeHtml(age)} &nbsp;·&nbsp; ${qs.length} questions &nbsp;·&nbsp; ${date}</div>
  <hr class="divider">
  <div class="questions-body">
    ${questionsHTML}
  </div>
  <div class="answer-section">
    <hr class="divider">
    <h2>Answer Key</h2>
    ${answersHTML}
  </div>
</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^a-z0-9]/gi, '_')}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Sheet downloaded — open file and Ctrl+P to save as PDF', 'success');
};

// ===== UI HELPERS =====
function updateUI() {
  updateTotalBadge();
  populateAllDropdowns();
  renderTopicChips();
  if (currentTab === 'bank') filterQuestions();
  if (currentTab === 'generate') updateGenPreview();
}

function updateTotalBadge() {
  const el = document.getElementById('total-badge');
  if (el) el.textContent = `${questions.length} question${questions.length !== 1 ? 's' : ''}`;
}

window.showToast = function(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast${type ? ' ' + type : ''}`;
  el.textContent = msg;
  document.getElementById('toast-container')?.appendChild(el);
  setTimeout(() => el.remove(), 3500);
};

// Generate a simple fingerprint from question text for duplicate detection
function fingerprint(text) {
  const clean = text.toLowerCase().replace(/\s+/g, ' ').trim();
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = ((hash << 5) - hash) + clean.charCodeAt(i);
    hash |= 0;
  }
  return String(Math.abs(hash));
}

function isDuplicate(questionText) {
  const fp = fingerprint(questionText);
  return questions.some(q => q.fingerprint === fp);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

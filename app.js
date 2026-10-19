// Application State
let words = [];
let currentTab = 'cards';
let currentCardIndex = 0;
let randomizedCardList = []; // Для збереження рандомного порядку сесії
let isFlipped = false;
let quizCurrentWord = null;
let quizScore = 0;
let selectedMatchCards = [];

// AI State
let selectedAiLevel = 'A1';
let generatedAiWords = [];
let apiKey = localStorage.getItem('dl_gemini_key') || '';

// Firebase State
let firebaseDb = null;
let isFirebaseConnected = false;

document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  loadWords();
  initLucide();
  switchTab('cards');
  setupKeyboardShortcuts();
});

function initLucide() {
  if (window.lucide) {
    lucide.createIcons();
  }
}

// ----------------------------------------------------
// FIREBASE & STORAGE
// ----------------------------------------------------
function initFirebase() {
  const dbUrl = localStorage.getItem('dl_fb_db_url') || '';
  const configRaw = localStorage.getItem('dl_fb_config') || '';

  if (!dbUrl && !configRaw) {
    updateSyncBadge(false);
    return;
  }

  try {
    let config = {};
    if (configRaw) {
      try { config = JSON.parse(configRaw); } catch (e) {}
    }
    if (!config.databaseURL && dbUrl) {
      config.databaseURL = dbUrl;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(config);
    }

    firebaseDb = firebase.database();
    isFirebaseConnected = true;
    updateSyncBadge(true);

    firebaseDb.ref('words').on('value', (snapshot) => {
      const remoteData = snapshot.val();
      if (remoteData) {
        let remoteArray = Array.isArray(remoteData) ? remoteData : Object.values(remoteData);
        mergeAndApplyWords(remoteArray);
      }
    });
  } catch (err) {
    console.error('Firebase error:', err);
    updateSyncBadge(false);
  }
}

function updateSyncBadge(connected) {
  const badge = document.getElementById('sync-status-badge');
  if (!badge) return;
  if (connected) {
    badge.textContent = 'Хмарна (Firebase)';
    badge.className = 'font-medium text-emerald-400';
  } else {
    badge.textContent = 'Локальна (localStorage)';
    badge.className = 'font-medium text-slate-500';
  }
}

function loadWords() {
  const saved = localStorage.getItem('dl_words');
  let localWords = [];
  if (saved) {
    try { localWords = JSON.parse(saved); } catch (e) { localWords = []; }
  }
  mergeAndApplyWords(localWords);
}

function mergeAndApplyWords(newWordsArray) {
  const mergedMap = new Map();

  if (typeof defaultWords !== 'undefined' && Array.isArray(defaultWords)) {
    defaultWords.forEach(w => {
      if (w && w.word) mergedMap.set(w.word.toLowerCase(), w);
    });
  }

  words.forEach(w => {
    if (w && w.word) mergedMap.set(w.word.toLowerCase(), w);
  });

  if (Array.isArray(newWordsArray)) {
    newWordsArray.forEach(w => {
      if (w && w.word) mergedMap.set(w.word.toLowerCase(), w);
    });
  }

  words = Array.from(mergedMap.values());
  localStorage.setItem('dl_words', JSON.stringify(words));
  updateStats();

  if (currentTab === 'dict') renderDictionary();
  if (currentTab === 'cards') prepareFlashcardDeck();
}

function saveWords() {
  localStorage.setItem('dl_words', JSON.stringify(words));
  updateStats();

  if (isFirebaseConnected && firebaseDb) {
    firebaseDb.ref('words').set(words).catch(err => {
      console.error('Firebase save error:', err);
    });
  }
}

function updateStats() {
  document.getElementById('stat-total').textContent = words.length;
  document.getElementById('stat-learned').textContent = words.filter(w => w.box === 5).length;
}

// ----------------------------------------------------
// NAVIGATION
// ----------------------------------------------------
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-btn, .mob-nav-btn').forEach(btn => {
    btn.classList.remove('bg-slate-800', 'text-white', 'text-indigo-400');
    btn.classList.add('text-slate-400');
  });

  document.getElementById(`tab-${tab}-content`).classList.remove('hidden');

  const desktopBtn = document.getElementById(`nav-${tab}`);
  const mobBtn = document.getElementById(`mob-nav-${tab}`);
  if (desktopBtn) { desktopBtn.classList.add('bg-slate-800', 'text-white'); desktopBtn.classList.remove('text-slate-400'); }
  if (mobBtn) { mobBtn.classList.add('text-indigo-400'); mobBtn.classList.remove('text-slate-400'); }

  const titles = {
    cards: 'Картки для вивчення',
    'ai-gen': 'Генератор слів від ШІ',
    quiz: 'Тестування та написання',
    match: "З'єднай пари",
    dict: 'Словник та керування'
  };
  document.getElementById('tab-title').textContent = titles[tab] || '';

  if (tab === 'cards') prepareFlashcardDeck();
  if (tab === 'quiz') nextQuizQuestion();
  if (tab === 'match') initMatchGame();
  if (tab === 'dict') renderDictionary();
}

// ----------------------------------------------------
// SETTINGS
// ----------------------------------------------------
function openSettingsModal() {
  document.getElementById('settings-modal').classList.remove('hidden');
  document.getElementById('api-key-input').value = apiKey;
  document.getElementById('fb-db-url').value = localStorage.getItem('dl_fb_db_url') || '';
  document.getElementById('fb-config-json').value = localStorage.getItem('dl_fb_config') || '';
}

function closeSettingsModal() { document.getElementById('settings-modal').classList.add('hidden'); }

function saveSettings() {
  apiKey = document.getElementById('api-key-input').value.trim();
  localStorage.setItem('dl_gemini_key', apiKey);
  localStorage.setItem('dl_fb_db_url', document.getElementById('fb-db-url').value.trim());
  localStorage.setItem('dl_fb_config', document.getElementById('fb-config-json').value.trim());
  closeSettingsModal();
  initFirebase();
  alert('Налаштування збережено!');
}

// ----------------------------------------------------
// AI (GEMINI) INTEGRATION
// ----------------------------------------------------
async function callGeminiAPI(prompt) {
  if (!apiKey) {
    openSettingsModal();
    alert("Будь ласка, введіть свій Gemini API Key.");
    return null;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey.trim()}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });
    const data = await response.json();
    if (!response.ok) {
      alert(`Помилка API: ${data.error?.message || 'Невідома помилка'}`);
      return null;
    }
    return JSON.parse(data.candidates[0].content.parts[0].text);
  } catch (err) {
    alert(`Помилка: ${err.message}`);
    return null;
  }
}

function selectAiLevel(level) {
  selectedAiLevel = level;
  document.querySelectorAll('.ai-lvl-btn').forEach(btn => {
    if (btn.textContent.trim() === level) {
      btn.className = 'ai-lvl-btn bg-indigo-600 border border-indigo-500 text-white font-semibold py-2 rounded-xl text-sm transition';
    } else {
      btn.className = 'ai-lvl-btn bg-slate-950 border border-slate-800 text-slate-400 hover:text-white py-2 rounded-xl text-sm transition';
    }
  });
}

async function generateRandomWordsAI() {
  const count = document.getElementById('ai-count').value;
  const topic = document.getElementById('ai-topic').value.trim();
  const loading = document.getElementById('ai-loading');
  const resultsContainer = document.getElementById('ai-results-container');
  const genBtn = document.getElementById('ai-gen-btn');

  loading.classList.remove('hidden');
  resultsContainer.classList.add('hidden');
  genBtn.disabled = true;

  const existingWords = words.slice(-40).map(w => w.word).join(', ');
  const prompt = `Згенеруй ${count} елементів (іменники з артиклями або дієслова з формами) німецькою мовою рівня ${selectedAiLevel} ${topic ? 'на тему/тип: ' + topic : ''}.
Не повторюй: [${existingWords}].

Поверни СТРОГО JSON масив:
[
  {
    "article": "der", "die", "das" або "none",
    "word": "слово або інфінітив дієслова",
    "plural": "форма множини для іменників або порожньо",
    "presents": "форма Präsens 3 особи однини (для дієслів, напр. spricht) або порожньо",
    "preteritum": "форма Präteritum (для дієслів, напр. sprach) або порожньо",
    "perfekt": "форма Perfekt (для дієслів, напр. hat gesprochen) або порожньо",
    "translation": "переклад українською",
    "example": "речення-приклад німецькою"
  }
]`;

  const result = await callGeminiAPI(prompt);
  loading.classList.add('hidden');
  genBtn.disabled = false;

  if (result && Array.isArray(result)) {
    generatedAiWords = result;
    renderAiResultsList();
    resultsContainer.classList.remove('hidden');
  }
}

function renderAiResultsList() {
  const listEl = document.getElementById('ai-words-list');
  listEl.innerHTML = '';
  generatedAiWords.forEach((w) => {
    const item = document.createElement('div');
    item.className = 'bg-slate-950 border border-slate-800 p-3 rounded-xl flex justify-between items-center text-xs';
    const artText = w.article && w.article !== 'none' ? `<span class="font-semibold">${w.article}</span> ` : '';
    const verbInfo = w.presents ? `<div class="text-indigo-300">Форми: ${w.presents}, ${w.preteritum}, ${w.perfekt}</div>` : '';

    item.innerHTML = `
      <div>
        <div class="font-bold text-white text-sm">${artText}${w.word}</div>
        ${verbInfo}
        <div class="text-slate-300">${w.translation}</div>
      </div>
    `;
    listEl.appendChild(item);
  });
}

function saveAllAiWords() {
  if (generatedAiWords.length === 0) return;
  generatedAiWords.forEach(w => {
    words.push({
      id: Date.now() + Math.random(),
      article: w.article || 'none',
      word: w.word,
      plural: w.plural || '',
      presents: w.presents || '',
      preteritum: w.preteritum || '',
      perfekt: w.perfekt || '',
      translation: w.translation,
      example: w.example || '',
      box: 1
    });
  });
  saveWords();
  alert(`Додано ${generatedAiWords.length} елементів!`);
  generatedAiWords = [];
  document.getElementById('ai-results-container').classList.add('hidden');
}

async function autoFillWordWithAI() {
  const wordInput = document.getElementById('modal-word').value.trim();
  if (!wordInput) { alert('Введіть слово.'); return; }

  const prompt = `Проаналізуй німецьке слово або дієслово "${wordInput}". 
Поверни СТРОГО JSON об'єкт:
{
  "article": "der", "die", "das" або "none",
  "word": "слово",
  "plural": "форма множини або порожньо",
  "presents": "Präsens 3 особа або порожньо",
  "preteritum": "Präteritum або порожньо",
  "perfekt": "Perfekt або порожньо",
  "translation": "переклад українською",
  "example": "приклад речення"
}`;

  const res = await callGeminiAPI(prompt);
  if (res) {
    if (res.article) document.getElementById('modal-article').value = res.article;
    if (res.word) document.getElementById('modal-word').value = res.word;
    if (res.plural) document.getElementById('modal-plural').value = res.plural;
    if (res.presents) document.getElementById('modal-presents').value = res.presents;
    if (res.preteritum) document.getElementById('modal-preteritum').value = res.preteritum;
    if (res.perfekt) document.getElementById('modal-perfekt').value = res.perfekt;
    if (res.translation) document.getElementById('modal-translation').value = res.translation;
    if (res.example) document.getElementById('modal-example').value = res.example;
  }
}

// ----------------------------------------------------
// TAB 1: FLASHCARDS (З вибором режиму та рівнів)
// ----------------------------------------------------
function prepareFlashcardDeck() {
  const boxFilter = document.getElementById('filter-box')?.value || 'all';
  const modeFilter = document.getElementById('filter-mode')?.value || 'sequential';

  let filtered = words;
  if (boxFilter !== 'all') {
    const targetBox = parseInt(boxFilter, 10);
    filtered = words.filter(w => (w.box || 1) === targetBox);
  }

  if (modeFilter === 'random') {
    randomizedCardList = [...filtered].sort(() => 0.5 - Math.random());
  } else {
    randomizedCardList = [...filtered];
  }

  currentCardIndex = 0;
  renderFlashcard();
}

function renderFlashcard() {
  const cardEl = document.getElementById('flashcard');
  cardEl.classList.remove('flipped');
  isFlipped = false;

  const list = randomizedCardList;
  if (list.length === 0) {
    document.getElementById('card-word-display').innerHTML = '<span class="text-sm text-slate-500">Немає слів у цій категорії</span>';
    document.getElementById('card-sub-display').textContent = '';
    document.getElementById('card-counter').textContent = '0 з 0';
    document.getElementById('card-verb-forms-display').classList.add('hidden');
    return;
  }

  if (currentCardIndex >= list.length) currentCardIndex = 0;

  const word = list[currentCardIndex];
  document.getElementById('card-counter').textContent = `Слово ${currentCardIndex + 1} з ${list.length}`;
  document.getElementById('card-box-tag').textContent = `Рівень ${word.box || 1}`;

  const artText = word.article && word.article !== 'none' ? `<span class="article-${word.article}">${word.article}</span> ` : '';
  document.getElementById('card-word-display').innerHTML = `${artText}${word.word}`;

  // Підзаголовок (plural або коротка інфо)
  if (word.plural) {
    document.getElementById('card-sub-display').textContent = `Pl.: ${word.plural}`;
  } else if (word.presents) {
    document.getElementById('card-sub-display').textContent = `${word.presents}, ${word.preteritum}`;
  } else {
    document.getElementById('card-sub-display').textContent = '';
  }

  document.getElementById('card-translation-display').textContent = word.translation;
  
  // Додаткові форми дієслова на звороті
  const verbBox = document.getElementById('card-verb-forms-display');
  if (word.presents || word.preteritum || word.perfekt) {
    verbBox.textContent = `Форми: ${word.presents || '—'} | ${word.preteritum || '—'} | ${word.perfekt || '—'}`;
    verbBox.classList.remove('hidden');
  } else {
    verbBox.classList.add('hidden');
  }

  document.getElementById('card-example-display').textContent = word.example ? `"${word.example}"` : 'Приклад відсутній';
}

function flipCard() {
  const cardEl = document.getElementById('flashcard');
  cardEl.classList.toggle('flipped');
  isFlipped = !isFlipped;
}

function answerCard(success) {
  const list = randomizedCardList;
  if (list.length === 0) return;

  const currentCard = list[currentCardIndex];
  // Знаходимо оригінальне слово в основному масиві за id
  const originalWord = words.find(w => w.id === currentCard.id);

  if (originalWord) {
    if (success) {
      originalWord.box = Math.min(5, (originalWord.box || 1) + 1);
    } else {
      originalWord.box = 1; // Повертаємо на початковий рівень для повторення
    }
    saveWords();
  }

  currentCardIndex++;
  if (currentCardIndex >= list.length) {
    // Якщо дійшли до кінця колоди, оновлюємо її знову
    prepareFlashcardDeck();
  } else {
    renderFlashcard();
  }
}

function speakCurrentWord() {
  const list = randomizedCardList;
  if (list.length === 0) return;
  const word = list[currentCardIndex];
  const textToSpeak = (word.article && word.article !== 'none' ? `${word.article} ` : '') + word.word;
  
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.lang = 'de-DE';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }
}

// ----------------------------------------------------
// TAB 2: QUIZ
// ----------------------------------------------------
function nextQuizQuestion() {
  if (words.length === 0) return;
  quizCurrentWord = words[Math.floor(Math.random() * words.length)];
  document.getElementById('quiz-target-translation').textContent = quizCurrentWord.translation;
  document.getElementById('quiz-input').value = '';
  document.getElementById('quiz-feedback').classList.add('hidden');
}

function checkQuizAnswer(e) {
  e.preventDefault();
  if (!quizCurrentWord) return;

  const input = document.getElementById('quiz-input').value.trim().toLowerCase();
  const fullCorrectWord = (quizCurrentWord.article && quizCurrentWord.article !== 'none' 
    ? `${quizCurrentWord.article} ${quizCurrentWord.word}` 
    : quizCurrentWord.word).toLowerCase();

  const feedback = document.getElementById('quiz-feedback');
  feedback.classList.remove('hidden', 'bg-emerald-500/20', 'text-emerald-400', 'bg-red-500/20', 'text-red-400');

  if (input === fullCorrectWord || input === quizCurrentWord.word.toLowerCase()) {
    quizScore += 10;
    feedback.classList.add('bg-emerald-500/20', 'text-emerald-400');
    feedback.textContent = 'Правильно!';
    quizCurrentWord.box = Math.min(5, (quizCurrentWord.box || 1) + 1);
  } else {
    feedback.classList.add('bg-red-500/20', 'text-red-400');
    feedback.textContent = `Помилка. Правильно: ${fullCorrectWord}`;
    quizCurrentWord.box = 1;
  }

  document.getElementById('quiz-score').textContent = `Рахунок: ${quizScore}`;
  saveWords();
  setTimeout(() => nextQuizQuestion(), 1500);
}

function insertChar(char) {
  const input = document.getElementById('quiz-input');
  input.value += char;
  input.focus();
}

// ----------------------------------------------------
// TAB 3: MATCH PAIRS
// ----------------------------------------------------
function initMatchGame() {
  const grid = document.getElementById('match-grid');
  grid.innerHTML = '';
  selectedMatchCards = [];

  if (words.length < 4) {
    grid.innerHTML = '<p class="col-span-full text-center text-slate-500">Додайте мінімум 4 слова</p>';
    return;
  }

  const shuffled = [...words].sort(() => 0.5 - Math.random()).slice(0, 4);
  let cardsData = [];
  shuffled.forEach(w => {
    const germanText = (w.article && w.article !== 'none' ? `${w.article} ` : '') + w.word;
    cardsData.push({ id: w.id, text: germanText, type: 'de' });
    cardsData.push({ id: w.id, text: w.translation, type: 'ua' });
  });

  cardsData.sort(() => 0.5 - Math.random());
  cardsData.forEach((c, idx) => {
    const btn = document.createElement('button');
    btn.className = 'match-card bg-slate-900 border border-slate-800 hover:border-indigo-500/50 rounded-xl p-4 text-sm font-medium transition flex items-center justify-center text-center min-h-[90px]';
    btn.dataset.id = c.id;
    btn.dataset.type = c.type;
    btn.textContent = c.text;
    btn.onclick = () => handleMatchSelect(btn);
    grid.appendChild(btn);
  });
}

function handleMatchSelect(btn) {
  if (btn.classList.contains('matched') || selectedMatchCards.includes(btn)) return;
  btn.classList.add('border-indigo-500', 'bg-indigo-500/10');
  selectedMatchCards.push(btn);

  if (selectedMatchCards.length === 2) {
    const [c1, c2] = selectedMatchCards;
    if (c1.dataset.id === c2.dataset.id && c1.dataset.type !== c2.dataset.type) {
      setTimeout(() => {
        c1.classList.add('opacity-0', 'pointer-events-none');
        c2.classList.add('opacity-0', 'pointer-events-none');
        selectedMatchCards = [];
        if (document.querySelectorAll('.match-card:not(.opacity-0)').length === 0) {
          setTimeout(() => { alert('Чудово! Усі пари знайдено!'); initMatchGame(); }, 300);
        }
      }, 300);
    } else {
      setTimeout(() => {
        c1.classList.remove('border-indigo-500', 'bg-indigo-500/10');
        c2.classList.remove('border-indigo-500', 'bg-indigo-500/10');
        selectedMatchCards = [];
      }, 600);
    }
  }
}

// ----------------------------------------------------
// TAB 4: DICTIONARY
// ----------------------------------------------------
function renderDictionary() {
  const tbody = document.getElementById('dict-table-body');
  const search = document.getElementById('dict-search')?.value.toLowerCase() || '';
  tbody.innerHTML = '';

  const filtered = words.filter(w => w.word.toLowerCase().includes(search) || w.translation.toLowerCase().includes(search));
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500">Слів не знайдено</td></tr>';
    return;
  }

  filtered.forEach(w => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/30 transition';
    const artText = w.article && w.article !== 'none' ? `<span class="font-semibold">${w.article}</span> ` : '';
    
    let subDetails = w.plural ? `Pl.: ${w.plural}` : '';
    if (w.presents) subDetails = `${w.presents} • ${w.preteritum} • ${w.perfekt}`;

    tr.innerHTML = `
      <td class="p-3 font-medium">${artText}${w.word} <span class="text-[11px] text-slate-400 block">${subDetails}</span></td>
      <td class="p-3 text-slate-300">${w.translation}</td>
      <td class="p-3 text-slate-400 italic hidden sm:table-cell text-xs">${w.example || '—'}</td>
      <td class="p-3 text-center"><span class="px-2 py-0.5 rounded text-xs bg-slate-800 border border-slate-700">${w.box || 1}</span></td>
      <td class="p-3 text-right space-x-1">
        <button onclick="editWord(${w.id})" class="p-1.5 text-slate-400 hover:text-white transition"><i data-lucide="pencil" class="w-4 h-4"></i></button>
        <button onclick="deleteWord(${w.id})" class="p-1.5 text-slate-400 hover:text-red-400 transition"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  initLucide();
}

function openAddModal(editId = null) {
  document.getElementById('word-modal').classList.remove('hidden');
  if (editId) {
    const w = words.find(item => item.id === editId);
    if (w) {
      document.getElementById('modal-title').textContent = 'Редагувати елемент';
      document.getElementById('modal-word-id').value = w.id;
      document.getElementById('modal-article').value = w.article || 'none';
      document.getElementById('modal-word').value = w.word;
      document.getElementById('modal-plural').value = w.plural || '';
      document.getElementById('modal-presents').value = w.presents || '';
      document.getElementById('modal-preteritum').value = w.preteritum || '';
      document.getElementById('modal-perfekt').value = w.perfekt || '';
      document.getElementById('modal-translation').value = w.translation;
      document.getElementById('modal-example').value = w.example || '';
    }
  } else {
    document.getElementById('modal-title').textContent = 'Додати нове слово / дієслово';
    document.getElementById('modal-word-id').value = '';
    document.getElementById('modal-article').value = 'none';
    document.getElementById('modal-word').value = '';
    document.getElementById('modal-plural').value = '';
    document.getElementById('modal-presents').value = '';
    document.getElementById('modal-preteritum').value = '';
    document.getElementById('modal-perfekt').value = '';
    document.getElementById('modal-translation').value = '';
    document.getElementById('modal-example').value = '';
  }
}

function closeAddModal() { document.getElementById('word-modal').classList.add('hidden'); }

function saveWord(e) {
  e.preventDefault();
  const idVal = document.getElementById('modal-word-id').value;
  const wordData = {
    id: idVal ? parseFloat(idVal) : Date.now(),
    article: document.getElementById('modal-article').value,
    word: document.getElementById('modal-word').value.trim(),
    plural: document.getElementById('modal-plural').value.trim(),
    presents: document.getElementById('modal-presents').value.trim(),
    preteritum: document.getElementById('modal-preteritum').value.trim(),
    perfekt: document.getElementById('modal-perfekt').value.trim(),
    translation: document.getElementById('modal-translation').value.trim(),
    example: document.getElementById('modal-example').value.trim(),
    box: 1
  };

  if (idVal) {
    const idx = words.findIndex(w => w.id === parseFloat(idVal));
    if (idx !== -1) {
      wordData.box = words[idx].box || 1;
      words[idx] = wordData;
    }
  } else {
    words.push(wordData);
  }

  saveWords();
  closeAddModal();
  if (currentTab === 'dict') renderDictionary();
  if (currentTab === 'cards') prepareFlashcardDeck();
}

function editWord(id) { openAddModal(id); }

function deleteWord(id) {
  if (confirm('Видалити цей елемент?')) {
    words = words.filter(w => w.id !== id);
    saveWords();
    renderDictionary();
  }
}

function exportWords() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(words, null, 2));
  const dl = document.createElement('a');
  dl.setAttribute("href", dataStr);
  dl.setAttribute("download", `deutsch_words_${new Date().toISOString().slice(0,10)}.json`);
  document.body.appendChild(dl);
  dl.click();
  dl.remove();
}

function downloadUpdatedWordsJs() {
  const fileContent = `const defaultWords = ${JSON.stringify(words, null, 2)};`;
  const blob = new Blob([fileContent], { type: 'application/javascript' });
  const dl = document.createElement('a');
  dl.href = URL.createObjectURL(blob);
  dl.download = 'words.js';
  document.body.appendChild(dl);
  dl.click();
  dl.remove();
}

function importWords(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const imported = JSON.parse(e.target.result);
      if (Array.isArray(imported)) {
        words = imported;
        saveWords();
        renderDictionary();
        alert('Словник імпортовано!');
      }
    } catch (err) { alert('Помилка JSON файлу.'); }
  };
  reader.readAsText(file);
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (currentTab === 'cards') {
      if (e.code === 'Space') { e.preventDefault(); flipCard(); }
      else if (e.code === 'ArrowLeft') { answerCard(false); }
      else if (e.code === 'ArrowRight') { answerCard(true); }
    }
  });
}
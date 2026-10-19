// Application State
let words = [];
let currentTab = 'cards';
let currentCardIndex = 0;
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

// Initialize App
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
// FIREBASE SYNCHRONIZATION
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
      try {
        config = JSON.parse(configRaw);
      } catch (e) {
        console.warn('Невірний JSON у конфігу Firebase, використовуємо прямий databaseURL.');
      }
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

    // Слухач оновлень у реальному часі
    firebaseDb.ref('words').on('value', (snapshot) => {
      const remoteData = snapshot.val();
      if (remoteData) {
        let remoteArray = Array.isArray(remoteData) ? remoteData : Object.values(remoteData);
        mergeAndApplyWords(remoteArray);
      }
    });

  } catch (err) {
    console.error('Помилка ініціалізації Firebase:', err);
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

// ----------------------------------------------------
// STORAGE & DATA MERGING
// ----------------------------------------------------
function loadWords() {
  const saved = localStorage.getItem('dl_words');
  let localWords = [];
  
  if (saved) {
    try {
      localWords = JSON.parse(saved);
      if (!Array.isArray(localWords)) localWords = [];
    } catch (e) {
      localWords = [];
    }
  }

  mergeAndApplyWords(localWords);
}

function mergeAndApplyWords(newWordsArray) {
  const mergedMap = new Map();

  // 1. Спочатку додаємо дефолтні з words.js
  if (typeof defaultWords !== 'undefined' && Array.isArray(defaultWords)) {
    defaultWords.forEach(w => {
      if (w && w.word) mergedMap.set(w.word.toLowerCase(), w);
    });
  }

  // 2. Спочатку поточні
  words.forEach(w => {
    if (w && w.word) mergedMap.set(w.word.toLowerCase(), w);
  });

  // 3. Накладаємо нові отримані слова (вони перезаписують прогрес та додають нові)
  if (Array.isArray(newWordsArray)) {
    newWordsArray.forEach(w => {
      if (w && w.word) mergedMap.set(w.word.toLowerCase(), w);
    });
  }

  words = Array.from(mergedMap.values());
  
  // Зберігаємо в localStorage
  localStorage.setItem('dl_words', JSON.stringify(words));
  updateStats();

  if (currentTab === 'dict') renderDictionary();
  if (currentTab === 'cards') renderFlashcard();
}

function saveWords() {
  // Збереження у локальне сховище
  localStorage.setItem('dl_words', JSON.stringify(words));
  updateStats();

  // Збереження у хмару Firebase, якщо вона підключена
  if (isFirebaseConnected && firebaseDb) {
    firebaseDb.ref('words').set(words).catch(err => {
      console.error('Помилка збереження у Firebase:', err);
    });
  }
}

function updateStats() {
  document.getElementById('stat-total').textContent = words.length;
  document.getElementById('stat-learned').textContent = words.filter(w => w.box === 5).length;
}

// ----------------------------------------------------
// NAVIGATION HANDLER
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
  
  if (desktopBtn) {
    desktopBtn.classList.add('bg-slate-800', 'text-white');
    desktopBtn.classList.remove('text-slate-400');
  }
  if (mobBtn) {
    mobBtn.classList.add('text-indigo-400');
    mobBtn.classList.remove('text-slate-400');
  }

  const titles = {
    cards: 'Картки для вивчення',
    'ai-gen': 'Генератор слів від ШІ',
    quiz: 'Тестування та написання',
    match: 'З\'єднай пари',
    dict: 'Словник та керування'
  };
  document.getElementById('tab-title').textContent = titles[tab] || '';

  if (tab === 'cards') renderFlashcard();
  if (tab === 'quiz') nextQuizQuestion();
  if (tab === 'match') initMatchGame();
  if (tab === 'dict') renderDictionary();
}

// ----------------------------------------------------
// SETTINGS MANAGEMENT
// ----------------------------------------------------
function openSettingsModal() {
  document.getElementById('settings-modal').classList.remove('hidden');
  document.getElementById('api-key-input').value = apiKey;
  document.getElementById('fb-db-url').value = localStorage.getItem('dl_fb_db_url') || '';
  document.getElementById('fb-config-json').value = localStorage.getItem('dl_fb_config') || '';
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.add('hidden');
}

function saveSettings() {
  const keyVal = document.getElementById('api-key-input').value.trim();
  const dbUrlVal = document.getElementById('fb-db-url').value.trim();
  const configJsonVal = document.getElementById('fb-config-json').value.trim();

  apiKey = keyVal;
  localStorage.setItem('dl_gemini_key', apiKey);
  localStorage.setItem('dl_fb_db_url', dbUrlVal);
  localStorage.setItem('dl_fb_config', configJsonVal);

  closeSettingsModal();
  initFirebase();
  alert('Налаштування успішно збережено!');
}

// ----------------------------------------------------
// AI INTEGRATION (GEMINI API)
// ----------------------------------------------------
async function callGeminiAPI(prompt) {
  if (!apiKey) {
    openSettingsModal();
    alert("Будь ласка, введіть свій Gemini API Key для використання функцій ШІ.");
    return null;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey.trim()}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          response_mime_type: "application/json"
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Деталі помилки Google API:', data);
      alert(`Помилка Google API (${response.status}): ${data.error?.message || JSON.stringify(data)}`);
      return null;
    }
    
    if (!data.candidates || !data.candidates[0]?.content?.parts[0]?.text) {
      throw new Error('Порожня відповідь від ШІ');
    }

    const rawText = data.candidates[0].content.parts[0].text;
    return JSON.parse(rawText);

  } catch (err) {
    console.error('AI Processing Error:', err);
    alert(`Помилка обробки: ${err.message}`);
    return null;
  }
}

function selectAiLevel(level) {
  selectedAiLevel = level;
  document.querySelectorAll('.ai-lvl-btn').forEach(btn => {
    if (btn.textContent === level) {
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

  const topicText = topic ? `на тему "${topic}"` : '';
  
  // Оптимізація: беремо останні 40 слів, щоб не роздувати промпт
  const existingWords = words.slice(-40).map(w => w.word).join(', ');

  const prompt = `Згенеруй ${count} рандомних німецьких слів рівень складності ${selectedAiLevel} ${topicText}.
Не повторюй ці слова: [${existingWords}].

Поверни результат СТРОГО у форматі JSON масиву об'єктів:
[
  {
    "article": "der", "die", "das" або "none",
    "word": "Слово з великої букви",
    "plural": "форма множини з артиклем die або порожньо",
    "translation": "переклад українською",
    "example": "коротке речення-приклад німецькою відповідно до рівня ${selectedAiLevel}"
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
    item.className = 'bg-slate-950 border border-slate-800/80 p-3 rounded-xl flex justify-between items-center text-xs';
    
    const artClass = `article-${w.article || 'none'}`;
    const artText = w.article && w.article !== 'none' ? `<span class="${artClass} font-semibold">${w.article}</span> ` : '';

    item.innerHTML = `
      <div>
        <div class="font-bold text-white text-sm">${artText}${w.word} <span class="text-slate-500 font-normal text-xs">(${w.plural || 'без plural'})</span></div>
        <div class="text-slate-300">${w.translation}</div>
        <div class="text-slate-500 italic text-[11px] mt-0.5">"${w.example}"</div>
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
      translation: w.translation,
      example: w.example || '',
      box: 1
    });
  });

  saveWords();
  alert(`Успішно додано ${generatedAiWords.length} слів у ваш словник!`);
  generatedAiWords = [];
  document.getElementById('ai-results-container').classList.add('hidden');
}

async function autoFillWordWithAI() {
  const wordInput = document.getElementById('modal-word').value.trim();
  if (!wordInput) {
    alert('Введіть хоча б слово німецькою мовою.');
    return;
  }

  const prompt = `Проаналізуй німецьке слово "${wordInput}". 
Поверни результат СТРОГО у вигляді одного JSON об'єкта:
{
  "article": "der", "die", "das" або "none",
  "word": "слово з великої букви",
  "plural": "форма множини з артиклем die або порожньо",
  "translation": "переклад українською",
  "example": "коротке речення-приклад німецькою"
}`;

  const res = await callGeminiAPI(prompt);
  if (res) {
    if (res.article) document.getElementById('modal-article').value = res.article;
    if (res.word) document.getElementById('modal-word').value = res.word;
    if (res.plural) document.getElementById('modal-plural').value = res.plural;
    if (res.translation) document.getElementById('modal-translation').value = res.translation;
    if (res.example) document.getElementById('modal-example').value = res.example;
  }
}

// ----------------------------------------------------
// TAB 1: FLASHCARDS
// ----------------------------------------------------
function getFilteredWords() {
  const filter = document.getElementById('filter-article')?.value || 'all';
  if (filter === 'all') return words;
  return words.filter(w => w.article === filter);
}

function renderFlashcard() {
  const list = getFilteredWords();
  const cardEl = document.getElementById('flashcard');
  cardEl.classList.remove('flipped');
  isFlipped = false;

  if (list.length === 0) {
    document.getElementById('card-word-display').innerHTML = '<span class="text-sm text-slate-500">Немає слів для відображення</span>';
    document.getElementById('card-plural-display').textContent = '';
    document.getElementById('card-counter').textContent = '0 з 0';
    return;
  }

  if (currentCardIndex >= list.length) currentCardIndex = 0;

  const word = list[currentCardIndex];
  document.getElementById('card-counter').textContent = `Слово ${currentCardIndex + 1} з ${list.length}`;
  document.getElementById('card-box-tag').textContent = `Рівень ${word.box || 1}`;

  const artClass = `article-${word.article || 'none'}`;
  const artText = word.article && word.article !== 'none' ? `<span class="${artClass}">${word.article}</span> ` : '';
  
  document.getElementById('card-word-display').innerHTML = `${artText}${word.word}`;
  document.getElementById('card-plural-display').textContent = word.plural ? `Pl.: ${word.plural}` : '';
  document.getElementById('card-translation-display').textContent = word.translation;
  document.getElementById('card-example-display').textContent = word.example ? `"${word.example}"` : 'Приклад відсутній';
}

function flipCard() {
  const cardEl = document.getElementById('flashcard');
  cardEl.classList.toggle('flipped');
  isFlipped = !isFlipped;
}

function answerCard(success) {
  const list = getFilteredWords();
  if (list.length === 0) return;

  const word = list[currentCardIndex];
  if (success) {
    word.box = Math.min(5, (word.box || 1) + 1);
  } else {
    word.box = 1;
  }

  saveWords();
  currentCardIndex = (currentCardIndex + 1) % list.length;
  renderFlashcard();
}

function speakCurrentWord() {
  const list = getFilteredWords();
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
// TAB 2: QUIZ / TYPING
// ----------------------------------------------------
function nextQuizQuestion() {
  if (words.length === 0) return;
  
  quizCurrentWord = words[Math.floor(Math.random() * words.length)];
  document.getElementById('quiz-target-translation').textContent = quizCurrentWord.translation;
  document.getElementById('quiz-input').value = '';
  
  const feedback = document.getElementById('quiz-feedback');
  feedback.classList.add('hidden');
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
    feedback.textContent = 'Правильно! Чудова робота!';
    quizCurrentWord.box = Math.min(5, (quizCurrentWord.box || 1) + 1);
  } else {
    feedback.classList.add('bg-red-500/20', 'text-red-400');
    feedback.textContent = `Помилка. Правильно: ${fullCorrectWord}`;
    quizCurrentWord.box = 1;
  }

  document.getElementById('quiz-score').textContent = `Рахунок: ${quizScore}`;
  saveWords();

  setTimeout(() => {
    nextQuizQuestion();
  }, 1800);
}

function insertChar(char) {
  const input = document.getElementById('quiz-input');
  input.value += char;
  input.focus();
}

// ----------------------------------------------------
// TAB 3: MATCH PAIRS GAME
// ----------------------------------------------------
function initMatchGame() {
  const grid = document.getElementById('match-grid');
  grid.innerHTML = '';
  selectedMatchCards = [];

  if (words.length < 4) {
    grid.innerHTML = '<p class="col-span-full text-center text-slate-500">Додайте щонайменше 4 слова для гри</p>';
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
    btn.dataset.index = idx;
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
    const [card1, card2] = selectedMatchCards;
    const isMatch = card1.dataset.id === card2.dataset.id && card1.dataset.type !== card2.dataset.type;

    if (isMatch) {
      setTimeout(() => {
        card1.classList.add('opacity-0', 'pointer-events-none');
        card2.classList.add('opacity-0', 'pointer-events-none');
        selectedMatchCards = [];
        
        const remaining = document.querySelectorAll('.match-card:not(.opacity-0)');
        if (remaining.length === 0) {
          setTimeout(() => {
            alert('Чудово! Усі пари знайдено!');
            initMatchGame();
          }, 300);
        }
      }, 300);
    } else {
      setTimeout(() => {
        card1.classList.remove('border-indigo-500', 'bg-indigo-500/10');
        card2.classList.remove('border-indigo-500', 'bg-indigo-500/10');
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

  const filtered = words.filter(w => 
    w.word.toLowerCase().includes(search) || 
    w.translation.toLowerCase().includes(search)
  );

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-slate-500">Слів не знайдено</td></tr>';
    return;
  }

  filtered.forEach(w => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/30 transition';
    
    const artClass = `article-${w.article || 'none'}`;
    const artText = w.article && w.article !== 'none' ? `<span class="${artClass} font-semibold">${w.article}</span> ` : '';

    tr.innerHTML = `
      <td class="p-3 font-medium">${artText}${w.word} <span class="text-xs text-slate-500 block">${w.plural || ''}</span></td>
      <td class="p-3 text-slate-300">${w.translation}</td>
      <td class="p-3 text-slate-400 italic hidden sm:table-cell text-xs">${w.example || '—'}</td>
      <td class="p-3 text-center"><span class="px-2 py-0.5 rounded text-xs bg-slate-800 border border-slate-700">${w.box || 1}</span></td>
      <td class="p-3 text-right space-x-1">
        <button onclick="editWord(${w.id})" class="p-1.5 text-slate-400 hover:text-white transition" title="Редагувати"><i data-lucide="pencil" class="w-4 h-4"></i></button>
        <button onclick="deleteWord(${w.id})" class="p-1.5 text-slate-400 hover:text-red-400 transition" title="Видалити"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  initLucide();
}

function openAddModal(editId = null) {
  const modal = document.getElementById('word-modal');
  modal.classList.remove('hidden');

  if (editId) {
    const w = words.find(item => item.id === editId);
    if (w) {
      document.getElementById('modal-title').textContent = 'Редагувати слово';
      document.getElementById('modal-word-id').value = w.id;
      document.getElementById('modal-article').value = w.article || 'none';
      document.getElementById('modal-word').value = w.word;
      document.getElementById('modal-plural').value = w.plural || '';
      document.getElementById('modal-translation').value = w.translation;
      document.getElementById('modal-example').value = w.example || '';
    }
  } else {
    document.getElementById('modal-title').textContent = 'Додати нове слово';
    document.getElementById('modal-word-id').value = '';
    document.getElementById('modal-article').value = 'none';
    document.getElementById('modal-word').value = '';
    document.getElementById('modal-plural').value = '';
    document.getElementById('modal-translation').value = '';
    document.getElementById('modal-example').value = '';
  }
}

function closeAddModal() {
  document.getElementById('word-modal').classList.add('hidden');
}

function saveWord(e) {
  e.preventDefault();
  const idVal = document.getElementById('modal-word-id').value;
  
  const wordData = {
    id: idVal ? parseFloat(idVal) : Date.now(),
    article: document.getElementById('modal-article').value,
    word: document.getElementById('modal-word').value.trim(),
    plural: document.getElementById('modal-plural').value.trim(),
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
  if (currentTab === 'cards') renderFlashcard();
}

function editWord(id) {
  openAddModal(id);
}

function deleteWord(id) {
  if (confirm('Ви дійсно бажаєте видалити це слово?')) {
    words = words.filter(w => w.id !== id);
    saveWords();
    renderDictionary();
  }
}

function exportWords() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(words, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `deutsch_words_${new Date().toISOString().slice(0,10)}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function downloadUpdatedWordsJs() {
  const fileContent = `const defaultWords = ${JSON.stringify(words, null, 2)};`;
  
  const blob = new Blob([fileContent], { type: 'application/javascript' });
  const downloadAnchor = document.createElement('a');
  downloadAnchor.href = URL.createObjectURL(blob);
  downloadAnchor.download = 'words.js';
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
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
        alert('Словник успішно імпортовано!');
      }
    } catch (err) {
      alert('Помилка при зчитуванні JSON файлу.');
    }
  };
  reader.readAsText(file);
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
      return;
    }

    if (currentTab === 'cards') {
      if (e.code === 'Space') {
        e.preventDefault();
        flipCard();
      } else if (e.code === 'ArrowLeft') {
        answerCard(false);
      } else if (e.code === 'ArrowRight') {
        answerCard(true);
      }
    }
  });
}
const MAX_TODOS = 5;
const EFFORT_OPTIONS = new Set([5, 15, 30, 55]);
const BOX_SEQUENCE = [
  { label: "Einatmen", seconds: 4 },
  { label: "Halten", seconds: 4 },
  { label: "Ausatmen", seconds: 4 },
  { label: "Halten", seconds: 4 }
];
const BOX_CYCLES = 2;

const STORAGE_KEYS = {
  todos: "pomodoro.todos",
  completedCount: "pomodoro.completedCount",
  playlist: "pomodoro.playlist",
  trackIndex: "pomodoro.trackIndex"
};

const state = {
  todos: [],
  selectedTodoId: null,
  completedCount: 0,
  flowActive: false,
  playlist: [],
  trackIndex: 0,
  isMusicPlaying: false
};

const refs = {
  todoForm: document.getElementById("todo-form"),
  todoTitleInput: document.getElementById("todo-title"),
  todoEffortSelect: document.getElementById("todo-effort"),
  todoLimitInfo: document.getElementById("todo-limit-info"),
  todoList: document.getElementById("todo-list"),
  selectedTask: document.getElementById("selected-task"),
  startFlowButton: document.getElementById("start-flow-btn"),
  template: document.getElementById("todo-item-template"),
  completedCount: document.getElementById("completed-count"),
  breathingPhase: document.getElementById("breathing-phase"),
  breathingTimer: document.getElementById("breathing-timer"),
  taskTitle: document.getElementById("task-title"),
  taskTimer: document.getElementById("task-timer"),
  stretchInfo: document.getElementById("stretch-info"),
  playlistForm: document.getElementById("playlist-form"),
  toggleMusicButton: document.getElementById("toggle-music-btn"),
  musicInfo: document.getElementById("music-info"),
  audio: document.getElementById("player"),
  toast: document.getElementById("app-toast")
};

let breathingIntervalId = null;
let taskIntervalId = null;

init();

function init() {
  loadStoredState();
  wireEvents();
  renderAll();
}

function loadStoredState() {
  state.todos = loadJSON(STORAGE_KEYS.todos, []);
  state.completedCount = Number(loadJSON(STORAGE_KEYS.completedCount, 0)) || 0;
  state.playlist = loadJSON(STORAGE_KEYS.playlist, []);
  state.trackIndex = Number(loadJSON(STORAGE_KEYS.trackIndex, 0)) || 0;
}

function wireEvents() {
  refs.todoForm.addEventListener("submit", onAddTodo);
  refs.startFlowButton.addEventListener("click", onStartFlow);
  refs.playlistForm.addEventListener("submit", onSavePlaylist);
  refs.toggleMusicButton.addEventListener("click", onToggleMusic);
  refs.audio.addEventListener("ended", onTrackEnded);
}

function renderAll() {
  refs.completedCount.textContent = String(state.completedCount);
  renderTodos();
  renderPlaylist();
  updateFlowControls();
}

function onAddTodo(event) {
  event.preventDefault();
  if (state.flowActive) {
    setToast("Während einer laufenden Session kannst du keine Todos ändern.", "warn");
    return;
  }
  if (state.todos.length >= MAX_TODOS) {
    setToast("Maximal 5 Todos erlaubt. Entferne erst ein Todo.", "warn");
    return;
  }

  const title = refs.todoTitleInput.value.trim();
  const effort = Number(refs.todoEffortSelect.value);
  if (!title || !EFFORT_OPTIONS.has(effort)) {
    setToast("Bitte Todo-Text und eine gültige Aufwandsschätzung angeben.", "warn");
    return;
  }

  state.todos.push({
    id: crypto.randomUUID(),
    title,
    effort
  });
  persistTodos();

  refs.todoForm.reset();
  refs.todoEffortSelect.value = "15";
  if (!state.selectedTodoId) {
    state.selectedTodoId = state.todos[0].id;
  }
  renderTodos();
  updateFlowControls();
  setToast("Todo hinzugefügt. Wähle jetzt dein erstes Todo aus.", "ok");
}

function onDeleteTodo(todoId) {
  if (state.flowActive) {
    setToast("Während einer Session ist Löschen gesperrt.", "warn");
    return;
  }
  state.todos = state.todos.filter((todo) => todo.id !== todoId);
  if (state.selectedTodoId === todoId) {
    state.selectedTodoId = state.todos.length > 0 ? state.todos[0].id : null;
  }
  persistTodos();
  renderTodos();
  updateFlowControls();
}

function onPickTodo(todoId) {
  if (state.flowActive) {
    setToast("Aktive Session läuft bereits. Neue Auswahl danach möglich.", "warn");
    return;
  }
  state.selectedTodoId = todoId;
  renderTodos();
  updateFlowControls();
}

function renderTodos() {
  refs.todoList.innerHTML = "";
  refs.todoLimitInfo.textContent = `Noch ${MAX_TODOS - state.todos.length} von ${MAX_TODOS} Todo-Slots frei.`;

  state.todos.forEach((todo, index) => {
    const fragment = refs.template.content.cloneNode(true);
    const item = fragment.querySelector(".todo-item");
    const title = fragment.querySelector(".todo-title");
    const meta = fragment.querySelector(".todo-meta");
    const pickButton = fragment.querySelector(".pick-btn");
    const deleteButton = fragment.querySelector(".delete-btn");

    title.textContent = `${index + 1}. ${todo.title}`;
    meta.textContent = `Aufwand: ${todo.effort} Minuten`;
    pickButton.textContent = state.selectedTodoId === todo.id ? "Gewählt" : "Als Erstes";
    if (state.selectedTodoId === todo.id) {
      item.classList.add("selected");
    }

    pickButton.addEventListener("click", () => onPickTodo(todo.id));
    deleteButton.addEventListener("click", () => onDeleteTodo(todo.id));
    refs.todoList.appendChild(fragment);
  });
}

function updateFlowControls() {
  const selectedTodo = getSelectedTodo();
  refs.selectedTask.textContent = selectedTodo
    ? `${selectedTodo.title} (${selectedTodo.effort} Min.)`
    : "Kein Todo ausgewählt";
  refs.startFlowButton.disabled = !selectedTodo || state.flowActive;
  refs.startFlowButton.textContent = state.flowActive ? "Flow läuft..." : "Flow starten";
}

async function onStartFlow() {
  if (state.flowActive) {
    return;
  }
  const todo = getSelectedTodo();
  if (!todo) {
    setToast("Bitte zuerst ein Todo als erstes auswählen.", "warn");
    return;
  }
  state.flowActive = true;
  updateFlowControls();
  refs.stretchInfo.textContent = "Stretch-Erinnerung wird während der Session eingeblendet.";
  refs.taskTitle.textContent = `Vorbereitung: ${todo.title}`;
  refs.taskTimer.textContent = formatTime(todo.effort * 60);
  setToast("Flow gestartet: zuerst Box Breathing, danach Fokus-Zeit.", "ok");

  if (state.playlist.length === 5 && !state.isMusicPlaying) {
    await playMusic().catch(() => {
      refs.musicInfo.textContent = "Musik konnte nicht gestartet werden (URL/CORS/Autoplay prüfen).";
    });
  }

  await runBoxBreathing();
  await runTaskTimer(todo);
}

function runBoxBreathing() {
  return new Promise((resolve) => {
    clearInterval(breathingIntervalId);
    const steps = [];
    for (let cycle = 1; cycle <= BOX_CYCLES; cycle += 1) {
      BOX_SEQUENCE.forEach((entry) => {
        steps.push({
          label: `${entry.label} (Runde ${cycle}/${BOX_CYCLES})`,
          seconds: entry.seconds
        });
      });
    }

    let stepIndex = 0;
    let stepSecondsLeft = steps[0].seconds;
    let totalSecondsLeft = steps.reduce((sum, step) => sum + step.seconds, 0);

    refs.breathingPhase.textContent = steps[0].label;
    refs.breathingTimer.textContent = formatTime(totalSecondsLeft);

    breathingIntervalId = setInterval(() => {
      totalSecondsLeft -= 1;
      stepSecondsLeft -= 1;

      if (totalSecondsLeft <= 0) {
        clearInterval(breathingIntervalId);
        refs.breathingPhase.textContent = "Box Breathing abgeschlossen";
        refs.breathingTimer.textContent = "00:00";
        resolve();
        return;
      }

      if (stepSecondsLeft <= 0) {
        stepIndex += 1;
        stepSecondsLeft = steps[stepIndex].seconds;
        refs.breathingPhase.textContent = steps[stepIndex].label;
      }

      refs.breathingTimer.textContent = formatTime(totalSecondsLeft);
    }, 1000);
  });
}

function runTaskTimer(todo) {
  return new Promise((resolve) => {
    clearInterval(taskIntervalId);
    const totalSeconds = todo.effort * 60;
    const stretchIntervalSeconds = totalSeconds >= 20 * 60 ? 10 * 60 : 5 * 60;
    let remaining = totalSeconds;
    let elapsed = 0;

    refs.taskTitle.textContent = `Fokus: ${todo.title}`;
    refs.taskTimer.textContent = formatTime(remaining);
    refs.stretchInfo.textContent = `Nächste Stretch-Erinnerung in ${Math.min(stretchIntervalSeconds, remaining)} Sekunden`;

    taskIntervalId = setInterval(() => {
      remaining -= 1;
      elapsed += 1;
      refs.taskTimer.textContent = formatTime(Math.max(remaining, 0));

      if (elapsed % stretchIntervalSeconds === 0 && remaining > 0) {
        const text = "Kurz aufstehen, Schultern lockern und strecken!";
        refs.stretchInfo.textContent = `${text} Weiter geht's mit Fokus.`;
        setToast(text, "warn");
        playStretchCue();
      } else if (remaining > 0) {
        const secondsToNext = stretchIntervalSeconds - (elapsed % stretchIntervalSeconds);
        refs.stretchInfo.textContent = `Nächste Stretch-Erinnerung in ${secondsToNext} Sekunden`;
      }

      if (remaining <= 0) {
        clearInterval(taskIntervalId);
        finishSession(todo);
        resolve();
      }
    }, 1000);
  });
}

function finishSession(todo) {
  state.completedCount += 1;
  refs.completedCount.textContent = String(state.completedCount);
  localStorage.setItem(STORAGE_KEYS.completedCount, String(state.completedCount));

  state.todos = state.todos.filter((entry) => entry.id !== todo.id);
  state.selectedTodoId = state.todos.length > 0 ? state.todos[0].id : null;
  persistTodos();

  refs.taskTitle.textContent = `Erledigt: ${todo.title}`;
  refs.taskTimer.textContent = "00:00";
  refs.stretchInfo.textContent = "Session fertig. Jetzt 1-2 Minuten aufstehen und stretchen.";
  setToast("Session beendet! Sehr gut — jetzt kurz stretchen.", "ok");

  state.flowActive = false;
  renderTodos();
  updateFlowControls();
}

function onSavePlaylist(event) {
  event.preventDefault();
  const urls = [1, 2, 3, 4, 5].map((index) =>
    document.getElementById(`song-${index}`).value.trim()
  );

  if (urls.some((url) => !url)) {
    setToast("Bitte alle 5 Song-URLs eintragen.", "warn");
    return;
  }

  state.playlist = urls;
  state.trackIndex = 0;
  localStorage.setItem(STORAGE_KEYS.playlist, JSON.stringify(state.playlist));
  localStorage.setItem(STORAGE_KEYS.trackIndex, String(state.trackIndex));
  refs.toggleMusicButton.disabled = false;
  refs.musicInfo.textContent = "Playlist gespeichert. Du kannst Musik starten.";
  setToast("Playlist gespeichert.", "ok");
}

function renderPlaylist() {
  [1, 2, 3, 4, 5].forEach((index) => {
    const input = document.getElementById(`song-${index}`);
    input.value = state.playlist[index - 1] || "";
  });
  refs.toggleMusicButton.disabled = state.playlist.length !== 5;
  refs.toggleMusicButton.textContent = state.isMusicPlaying ? "Musik pausieren" : "Musik starten";
  refs.musicInfo.textContent = state.playlist.length === 5
    ? `Playlist geladen (${state.trackIndex + 1}/5)`
    : "Noch keine Playlist gespeichert.";
}

async function onToggleMusic() {
  if (state.playlist.length !== 5) {
    setToast("Bitte zuerst eine Playlist mit genau 5 Songs speichern.", "warn");
    return;
  }

  if (state.isMusicPlaying) {
    refs.audio.pause();
    state.isMusicPlaying = false;
    refs.toggleMusicButton.textContent = "Musik starten";
    refs.musicInfo.textContent = "Musik pausiert.";
    return;
  }

  try {
    await playMusic();
  } catch (error) {
    refs.musicInfo.textContent = "Musik konnte nicht abgespielt werden. Prüfe die Song-URLs.";
    setToast("Musikstart fehlgeschlagen.", "warn");
  }
}

async function playMusic() {
  if (state.playlist.length !== 5) {
    return;
  }
  refs.audio.src = state.playlist[state.trackIndex];
  refs.audio.volume = 0.45;
  await refs.audio.play();
  state.isMusicPlaying = true;
  refs.toggleMusicButton.textContent = "Musik pausieren";
  refs.musicInfo.textContent = `Spielt Song ${state.trackIndex + 1} von 5`;
}

function onTrackEnded() {
  if (state.playlist.length !== 5) {
    return;
  }
  state.trackIndex = (state.trackIndex + 1) % state.playlist.length;
  localStorage.setItem(STORAGE_KEYS.trackIndex, String(state.trackIndex));
  playMusic().catch(() => {
    refs.musicInfo.textContent = "Nächster Song konnte nicht gestartet werden.";
  });
}

function persistTodos() {
  localStorage.setItem(STORAGE_KEYS.todos, JSON.stringify(state.todos));
}

function getSelectedTodo() {
  return state.todos.find((todo) => todo.id === state.selectedTodoId) || null;
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(safeSeconds / 60)).padStart(2, "0");
  const ss = String(safeSeconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function setToast(message, tone = "") {
  refs.toast.textContent = message;
  refs.toast.className = `toast ${tone}`.trim();
}

function playStretchCue() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 880;
  oscillator.connect(gain);
  gain.connect(context.destination);
  gain.gain.value = 0.05;
  oscillator.start();
  oscillator.stop(context.currentTime + 0.2);
  oscillator.addEventListener("ended", () => {
    context.close();
  });
}

function loadJSON(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

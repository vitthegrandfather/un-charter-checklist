const ARTICLES = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17, 18, 20, 22, 23, 24, 27, 28, 32, 33, 34,
  41, 42, 43, 45, 50, 51, 55, 61, 62, 75, 92, 97, 98, 102, 103, 110, 111,
];
const OLD_KEY = "un-charta-progress-v1",
  KEY = "un-charta-study-v2",
  UI_KEY = "un-charta-ui-v1",
  THEME_KEY = "un-charta-theme-v1",
  AUTH_PROMPT_KEY = "un-charta-auth-prompt-seen-v1",
  DEADLINE = new Date("2026-10-12T00:00:00+03:00"),
  DAY = 86400000,
  REVIEW_DAYS = 4;
const SUPABASE_URL = "https://xwdxfbgazlplyiglzecm.supabase.co",
  SUPABASE_KEY = "sb_publishable_yNV81pVLwznAKRN2fH3PBQ_ptbNVmFh";
const AVATARS = Array.from({ length: 30 }, (_, i) => `avatar-${String(i + 1).padStart(2, "0")}`);
const CARD_STYLES = ["classic", "sage", "sky", "lilac", "mint", "ocean", "sunset", "cocoa", "lemon", "lavender", "noir", "candy"];
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const blankState = () => ({
  learned: [],
  review: [],
  hard: [],
  difficulty: {},
  notes: {},
  learnedAt: {},
  nextReview: {},
  reviewLevel: {},
  studyDates: [],
  dailyPlans: {},
  vocabLearned: [],
  profileAvatar: "avatar-03",
  customAvatar: "",
  cardStyle: "classic",
});
function normalize(raw = {}) {
  const s = Object.assign(blankState(), raw);
  ["learned", "review", "hard", "studyDates", "vocabLearned"].forEach(
    (k) => (s[k] = Array.isArray(s[k]) ? s[k] : []),
  );
  s.difficulty =
    s.difficulty && typeof s.difficulty === "object" ? s.difficulty : {};
  s.dailyPlans =
    s.dailyPlans && typeof s.dailyPlans === "object" ? s.dailyPlans : {};
  s.hard.forEach((n) => {
    if (!s.difficulty[n]) s.difficulty[n] = "hard";
  });
  const legacyAvatars = { "🦊": "avatar-03", "🐼": "avatar-08", "🐸": "avatar-13", "🐯": "avatar-14", "🐙": "avatar-06", "🐧": "avatar-02", "🐝": "avatar-09", "🦉": "avatar-18" };
  s.profileAvatar = legacyAvatars[s.profileAvatar] || s.profileAvatar;
  if (![...AVATARS, "custom"].includes(s.profileAvatar)) s.profileAvatar = "avatar-03";
  if (typeof s.customAvatar !== "string" || !/^data:image\/(?:png|jpeg|webp);base64,/.test(s.customAvatar) || s.customAvatar.length > 180000) s.customAvatar = "";
  if (s.profileAvatar === "custom" && !s.customAvatar) s.profileAvatar = "avatar-03";
  if (!CARD_STYLES.includes(s.cardStyle)) s.cardStyle = "classic";
  return s;
}
const oldLearned = JSON.parse(localStorage.getItem(OLD_KEY) || "[]");
let state = normalize(
  Object.assign(
    { learned: oldLearned },
    JSON.parse(localStorage.getItem(KEY) || "{}"),
  ),
);
let savedUi = (() => {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY) || "{}");
  } catch {
    return {};
  }
})();
let cards = [],
  studyCards = [],
  order = [],
  cardIndex = 0,
  flipped = false,
  cardRotation = 0,
  cardPointerStart = null,
  cardSwipeHandled = false,
  noteArticle = null,
  reviewQueue = [],
  reviewIndex = 0,
  reviewFlipped = false,
  reviewPointerStart = null,
  reviewSwipeHandled = false,
  reviewResults = new Map(),
  currentUser = null,
  cloudTimer = null,
  authMode = "signin",
  currentProfile = null,
  groupProfiles = [],
  onlineStudy = new Map(),
  realtimeChannel = null,
  lastPresenceSignature = "",
  articleFilter = "all",
  vocabulary = [],
  vocabOrder = [],
  vocabIndex = 0,
  vocabFlipped = false,
  vocabRotation = 0,
  vocabLearnMode = Boolean(savedUi.vocabLearnMode),
  vocabGermanFirst = Boolean(savedUi.vocabGermanFirst),
  vocabShuffleAnchorId = Number.isInteger(savedUi.vocabShuffleAnchorId)
    ? savedUi.vocabShuffleAnchorId
    : null,
  vocabPointerStart = null,
  vocabSwipeHandled = false,
  vocabSwipeAnimating = false,
  vocabUndoStack = [],
  uiRestored = false;
const has = (k, n) => state[k].includes(n),
  todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
function save(action = true) {
  if (action && !state.studyDates.includes(todayKey()))
    state.studyDates.push(todayKey());
  localStorage.setItem(KEY, JSON.stringify(state));
  localStorage.setItem(
    OLD_KEY,
    JSON.stringify([...state.learned].sort((a, b) => a - b)),
  );
  renderAll();
  queueCloudSave();
}
function persistUiState(view) {
  if (!uiRestored) return;
  const activeView =
    view || $(".view.active")?.id?.replace(/View$/, "") || "tracker";
  const snapshot = {
    view: activeView,
    article: studyCards.length ? currentCard()?.n : null,
    articlePart: studyCards.length ? currentCard()?.part : null,
    articleOrder: studyCards.length ? order : [],
    vocabId: vocabulary.length ? currentVocab()?.id : null,
    vocabOrder: vocabulary.length ? vocabOrder : [],
    vocabLearnMode,
    vocabGermanFirst,
    vocabShuffleAnchorId,
  };
  localStorage.setItem(UI_KEY, JSON.stringify(snapshot));
  savedUi = snapshot;
}
function setCloudStatus(text) {
  $("#authBtn").title = text;
}
function queueCloudSave() {
  if (!currentUser || !client) return;
  setCloudStatus("Зберігаю в хмарі…");
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(saveCloud, 450);
}
async function saveCloud() {
  if (!currentUser) return;
  const { error } = await client
    .from("study_progress")
    .upsert(
      { user_id: currentUser.id, state, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  setCloudStatus(
    error
      ? "Не вдалося синхронізувати. Зміни лишились у браузері."
      : "Збережено в хмарі ✓",
  );
  if (!error && currentProfile?.display_name) await saveGroupProfile();
}
async function saveGroupProfile(name = currentProfile?.display_name) {
  if (!currentUser || !name) return;
  const cleanName = name.trim();
  const { error: metadataError } = await client.auth.updateUser({
    data: { display_name: cleanName },
  });
  if (metadataError) return metadataError;
  const row = {
    user_id: currentUser.id,
    display_name: cleanName,
    avatar: state.profileAvatar,
    custom_avatar: state.profileAvatar === "custom" ? state.customAvatar : "",
    card_style: state.cardStyle,
    learned_count: state.learned.length,
    hard_count: Object.values(state.difficulty).filter((x) => x === "hard")
      .length,
    streak: streak(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await client
    .from("group_profiles")
    .upsert(row, { onConflict: "user_id" });
  if (!error) {
    currentProfile = row;
    await loadLeaderboard();
    await realtimeChannel?.send({
      type: "broadcast",
      event: "profile-updated",
      payload: { user_id: currentUser.id },
    });
  }
  return error;
}
async function loadLeaderboard() {
  if (!currentUser) {
    groupProfiles = [];
    renderAccount();
    return;
  }
  const { data, error } = await client
    .from("group_profiles")
    .select("user_id,display_name,avatar,custom_avatar,card_style,learned_count,hard_count,streak,updated_at")
    .order("learned_count", { ascending: false })
    .order("updated_at", { ascending: true });
  groupProfiles = error ? [] : data || [];
  currentProfile =
    groupProfiles.find((p) => p.user_id === currentUser.id) || currentProfile;
  renderAccount();
}
async function useSession(session) {
  currentUser = session?.user || null;
  renderAuthStatus();
  if (!currentUser) return;
  setCloudStatus("Завантажую хмарний прогрес…");
  const { data, error } = await client
    .from("study_progress")
    .select("state")
    .eq("user_id", currentUser.id)
    .maybeSingle();
  if (error) {
    setCloudStatus("Помилка завантаження. Локальний прогрес збережено.");
    return;
  }
  if (data?.state) {
    state = normalize(data.state);
    localStorage.setItem(KEY, JSON.stringify(state));
    renderAll();
    setCloudStatus("Прогрес синхронізовано ✓");
  } else await saveCloud();
  await loadLeaderboard();
  startRealtime();
  if (!currentProfile) {
    const suggested = currentUser.user_metadata?.display_name || "";
    if (suggested) {
      const error = await saveGroupProfile(suggested);
      if (!error) return;
    }
    setAuthMode("profile");
    openAuth();
  }
}
function readPresence() {
  onlineStudy = new Map();
  if (!realtimeChannel) return;
  Object.values(realtimeChannel.presenceState()).flat().forEach((presence) => {
    if (!presence?.user_id) return;
    const previous = onlineStudy.get(presence.user_id);
    if (!previous || String(presence.updated_at) > String(previous.updated_at))
      onlineStudy.set(presence.user_id, presence);
  });
  renderAccount();
}
async function trackPresence(force = false) {
  if (!realtimeChannel || !currentUser) return;
  const cardsOpen = $("#cardsView")?.classList.contains("active");
  const vocabOpen = $("#vocabularyView")?.classList.contains("active");
  const article = cardsOpen && cards.length ? currentCard()?.n || null : null;
  const activity = vocabOpen ? "vocabulary" : cardsOpen ? "article" : "online";
  const signature = `${currentUser.id}:${activity}:${article || ""}:${state.profileAvatar}:${state.customAvatar.length}:${state.cardStyle}`;
  if (!force && signature === lastPresenceSignature) return;
  lastPresenceSignature = signature;
  await realtimeChannel.track({
    user_id: currentUser.id,
    article,
    activity,
    avatar: state.profileAvatar,
    custom_avatar: state.profileAvatar === "custom" ? state.customAvatar : "",
    card_style: state.cardStyle,
    updated_at: new Date().toISOString(),
  });
}
async function stopRealtime() {
  if (!realtimeChannel) return;
  const channel = realtimeChannel;
  realtimeChannel = null;
  lastPresenceSignature = "";
  onlineStudy = new Map();
  await channel.untrack();
  await client.removeChannel(channel);
}
async function startRealtime() {
  if (!client || !currentUser) return;
  if (realtimeChannel) await stopRealtime();
  realtimeChannel = client
    .channel("lernstudio-group", {
      config: { presence: { key: currentUser.id } },
    })
    .on("presence", { event: "sync" }, readPresence)
    .on("broadcast", { event: "profile-updated" }, loadLeaderboard)
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") await trackPresence(true);
    });
}
function renderAuthStatus() {
  if (currentUser) {
    $("#authBtn").innerHTML = `${avatarMarkup(state.profileAvatar, state.customAvatar, "nav-avatar")}<span>Акаунт</span>`;
    setCloudStatus("Прогрес синхронізується між пристроями");
    $("#signOutBtn").hidden = false;
    $("#authSubmit").hidden = true;
    $("#authSwitch").hidden = true;
    $("#authEmail").value = "";
    $("#authEmail").disabled = true;
    $("#authEmail").closest("label").hidden = true;
    $("#nameField").hidden = true;
    $("#authPassword").closest("label").hidden = true;
    $("#authIntro").textContent = currentProfile?.display_name
      ? `${currentProfile.display_name}, ваш прогрес синхронізується автоматично.`
      : "Ваш прогрес синхронізується автоматично.";
    $("#authTitle").textContent = "Ваш акаунт";
  } else {
    $("#authBtn").textContent = "Увійти";
    setCloudStatus("Увійти або створити акаунт");
    $("#signOutBtn").hidden = true;
    $("#authSubmit").hidden = false;
    $("#authSwitch").hidden = false;
    $("#authEmail").disabled = false;
    $("#authPassword").closest("label").hidden = false;
    $("#authIntro").textContent =
      "Увійдіть, щоб статті, складність і нотатки не загубилися та відкривалися на будь-якому пристрої.";
    setAuthMode("signin");
  }
}
function authErrorText(error) {
  if (error?.message?.toLowerCase().includes("email rate limit"))
    return "Тимчасово вичерпано ліміт листів підтвердження. Спробуйте трохи пізніше.";
  return error?.message || "Не вдалося виконати вхід. Спробуйте ще раз.";
}
function setAuthMode(mode) {
  authMode = mode;
  const profile = mode === "profile";
  const signin = mode === "signin";
  $("#authTitle").textContent = profile
    ? "Як вас звати?"
    : signin
      ? "Увійти"
      : "Створити акаунт";
  $("#authSubmit").textContent = profile
    ? "Зберегти ім’я"
    : signin
      ? "Увійти"
      : "Зареєструватися";
  $("#authSubmit").hidden = false;
  $("#nameField").hidden = signin;
  $("#authName").required = !signin;
  $("#authEmail").closest("label").hidden = profile;
  $("#authPassword").closest("label").hidden = profile;
  $("#authPassword").disabled = profile;
  $("#authSwitch").hidden = profile;
  $("#authSwitchText").textContent = signin
    ? "Вперше тут?"
    : "Уже маєте акаунт?";
  $("#authMode").textContent = signin ? "Створити акаунт" : "Увійти";
  $("#authPassword").autocomplete = signin
    ? "current-password"
    : "new-password";
  $("#authMessage").textContent = "";
}
function applyTheme(theme) {
  const dark = theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("#themeBtn").textContent = dark ? "☀" : "◐";
  $("#themeBtn").setAttribute(
    "aria-label",
    dark ? "Увімкнути світлу тему" : "Увімкнути темну тему",
  );
  $("#themeBtn").title = dark ? "Світла тема" : "Темна тема";
  localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  if ($("#accountThemeName")) renderAccount();
}
function toggle(k, n, value = !has(k, n)) {
  state[k] = state[k].filter((x) => x !== n);
  if (value) state[k].push(n);
}
function learn(n, value = !has("learned", n)) {
  toggle("learned", n, value);
  if (value) {
    state.learnedAt[n] = Date.now();
    state.nextReview[n] = Date.now() + DAY;
  } else {
    delete state.learnedAt[n];
    delete state.nextReview[n];
  }
  save();
}
function markReview(n, value = !has("review", n)) {
  toggle("review", n, value);
  if (value) state.nextReview[n] = Date.now();
  save();
}
function setDifficulty(n, level) {
  state.difficulty[n] = state.difficulty[n] === level ? "" : level;
  save();
}
function studyDaysLeft() {
  const start = new Date(DEADLINE);
  start.setDate(start.getDate() - REVIEW_DAYS);
  return Math.max(0, Math.ceil((start - new Date()) / DAY));
}
function dailyGoal() {
  const left = ARTICLES.length - state.learned.length,
    days = studyDaysLeft();
  return left === 0 ? 0 : days ? Math.ceil(left / days) : left;
}
function formatDate(d) {
  return new Intl.DateTimeFormat("uk-UA", {
    day: "numeric",
    month: "long",
  }).format(d);
}
function streak() {
  const dates = new Set(state.studyDates),
    d = new Date();
  let total = 0;
  if (!dates.has(todayKey())) d.setDate(d.getDate() - 1);
  while (true) {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!dates.has(k)) break;
    total++;
    d.setDate(d.getDate() - 1);
  }
  return total;
}
function forecast() {
  const left = ARTICLES.length - state.learned.length;
  if (!left) return "Готово ✓";
  const d = new Date();
  d.setDate(d.getDate() + Math.ceil(left / Math.max(1, dailyGoal())));
  return formatDate(d);
}
function todayPlan() {
  const key = todayKey();
  const saved = Array.isArray(state.dailyPlans[key])
    ? state.dailyPlans[key].filter((n) => ARTICLES.includes(n))
    : [];
  if (saved.length) return saved;
  const plan = ARTICLES.filter((n) => !has("learned", n)).slice(
    0,
    Math.max(0, dailyGoal()),
  );
  state.dailyPlans[key] = plan;
  localStorage.setItem(KEY, JSON.stringify(state));
  queueCloudSave();
  return plan;
}
function renderMetrics() {
  const done = state.learned.length;
  $("#doneCount").textContent = done;
  $("#progressBar").style.setProperty("--progress", done / ARTICLES.length);
  $("#streak").textContent = streak();
  $("#forecast").textContent = forecast();
  const goal = dailyGoal(),
    plan = todayPlan(),
    completed = plan.filter((n) => has("learned", n)).length,
    planDone = plan.length > 0 && completed === plan.length;
  $("#todayTitle").textContent = plan.length
    ? planDone
      ? "План виконано ✓"
      : `Виконано ${completed} з ${plan.length}`
    : "Час повторювати ✓";
  $("#todayList").innerHTML = plan.length
    ? plan
        .map(
          (n) =>
            `<button class="today-article ${has("learned", n) ? "done" : ""}" data-today-article="${n}" aria-label="Відкрити статтю ${n}"><span class="today-check" aria-hidden="true">${has("learned", n) ? "✓" : ""}</span><span class="today-name"><b>Стаття ${n}</b><small>Artikel ${n}</small></span></button>`,
        )
        .join("")
    : "<span class=\"today-complete\">Усі нові статті вже пройдено</span>";
  $("#startToday").textContent = planDone
    ? "Повторити план →"
    : "Продовжити план →";
  $("#dailyGoal").textContent = goal;
  const days = studyDaysLeft(),
    lag = Math.floor((Math.max(0, 24 - days) * ARTICLES.length) / 24) - done;
  let level =
    done === ARTICLES.length
      ? "green"
      : lag <= 1
        ? "green"
        : lag <= 4
          ? "yellow"
          : "red";
  if (!days && done < ARTICLES.length) level = "red";
  $("#pace").className = `pace ${level}`;
  $("#paceStatus").textContent =
    done === ARTICLES.length
      ? "Усе вивчено"
      : level === "green"
        ? "Темп нормальний"
        : level === "yellow"
          ? "Час прискоритись"
          : "Ризик не встигнути";
}
function articleCard(n) {
  const l = has("learned", n),
    r = has("review", n),
    d = state.difficulty[n] || "",
    note = state.notes[n];
  return `<article class="article ${l ? "learned" : ""} ${r ? "review" : ""} ${d === "hard" ? "hard" : ""}" data-n="${n}" tabindex="0" aria-label="Відкрити картку статті ${n}"><div class="article-title">Стаття ${n}<small>Artikel ${n}</small></div><div class="article-state">${l ? "Вивчено" : ""}${r ? " · Повторити" : ""}${d === "hard" ? " · Складна" : ""}</div><button class="learn-toggle article-primary ${l ? "state-on" : ""}">${l ? "✓ Вивчено" : "Позначити вивчено"}</button><div class="article-actions"><button class="hard-toggle ${d === "hard" ? "state-on" : ""}" data-level="hard">${d === "hard" ? "✓ Складна" : "Позначити як складну"}</button><button class="review-toggle ${r ? "state-on" : ""}">↻ Повторити</button></div><button class="note-toggle article-note ${note ? "state-on" : ""}">${note ? "✎ Є нотатка" : "＋ Нотатка"}</button></article>`;
}
function renderArticles() {
  const q = $("#search").value.trim().toLocaleLowerCase();
  const shown = ARTICLES.filter((n) => {
    const card = cards.find((c) => c.n === n);
    const matchesText =
      !q ||
      String(n).includes(q) ||
      card?.uk.toLocaleLowerCase().includes(q) ||
      card?.de.toLocaleLowerCase().includes(q);
    const matchesFilter =
      articleFilter === "all" ||
      (articleFilter === "learned" && has("learned", n)) ||
      (articleFilter === "hard" && state.difficulty[n] === "hard") ||
      (articleFilter === "review" && dueArticles().includes(n));
    return matchesText && matchesFilter;
  });
  $("#articleGrid").innerHTML = shown.map(articleCard).join("");
  $("#empty").style.display = shown.length ? "none" : "block";
}
function dueArticles() {
  const now = Date.now();
  return ARTICLES.filter(
    (n) =>
      has("review", n) ||
      (has("learned", n) && state.nextReview[n] && state.nextReview[n] <= now),
  );
}
function renderAll() {
  renderMetrics();
  renderArticles();
  $("#reviewBadge").textContent = dueArticles().length;
  renderCard();
  renderVocabulary();
  renderAccount();
}
const safe = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function avatarMarkup(avatar = "avatar-03", customAvatar = "", extraClass = "") {
  if (avatar === "custom" && customAvatar)
    return `<img class="avatar-image ${safe(extraClass)}" src="${safe(customAvatar)}" alt="" />`;
  const id = AVATARS.includes(avatar) ? avatar : "avatar-03";
  return `<span class="avatar-art ${id} ${safe(extraClass)}" aria-hidden="true"></span>`;
}
function renderAccount() {
  const hard = Object.values(state.difficulty).filter(
    (x) => x === "hard",
  ).length;
  $("#accountLearned").textContent = state.learned.length;
  $("#accountHard").textContent = hard;
  $("#accountStreak").textContent = streak();
  $("#accountReview").textContent = dueArticles().length;
  $("#accountThemeName").textContent =
    document.documentElement.dataset.theme === "dark"
      ? "Темна тема"
      : "Світла тема";
  $("#accountEmail").textContent =
    currentProfile?.display_name || "Гостьовий режим";
  $("#accountAvatar").innerHTML = avatarMarkup(state.profileAvatar, state.customAvatar);
  $(".account-identity").dataset.profileStyle = state.cardStyle;
  $$("#avatarPicker [data-avatar]").forEach((button) => {
    const selected = button.dataset.avatar === state.profileAvatar;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  $(".avatar-upload").classList.toggle("active", state.profileAvatar === "custom");
  $$("#cardStylePicker [data-card-style]").forEach((button) => {
    const selected = button.dataset.cardStyle === state.cardStyle;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  $("#editName").hidden = !currentUser;
  $("#accountAuth").textContent = currentUser
    ? "Керувати акаунтом"
    : "Увійти або зареєструватися";
  $("#memberCount").textContent = `${groupProfiles.length} учасників`;
  $("#leaderboardList").innerHTML = currentUser
    ? groupProfiles.length
      ? groupProfiles
          .map(
            (p, i) => {
              const presence = onlineStudy.get(p.user_id);
              const liveText = presence?.article
                ? `Зараз вчить статтю ${presence.article}`
                : presence?.activity === "vocabulary"
                  ? "Зараз вчить слова"
                : presence
                  ? "Зараз на сайті"
                  : "";
              const avatar = presence?.avatar || p.avatar || (p.user_id === currentUser?.id ? state.profileAvatar : "avatar-03");
              const customAvatar = presence?.custom_avatar || p.custom_avatar || (p.user_id === currentUser?.id ? state.customAvatar : "");
              const savedCardStyle = presence?.card_style || p.card_style;
              const cardStyle = CARD_STYLES.includes(savedCardStyle) ? savedCardStyle : (p.user_id === currentUser?.id ? state.cardStyle : "classic");
              return `<button class="leader-row${presence ? " is-online" : ""}" data-profile="${p.user_id}" data-profile-style="${cardStyle}"><b class="leader-rank">${i + 1}</b><span class="leader-avatar" aria-hidden="true">${avatarMarkup(avatar, customAvatar)}</span><span class="leader-copy"><strong>${safe(p.display_name)}</strong><span class="leader-meta"><small>${p.learned_count} з 39 статей</small>${liveText ? `<span class="live-status"><i aria-hidden="true"></i>${liveText}</span>` : ""}</span></span><em>${p.learned_count}</em></button>`;
            },
          )
          .join("")
      : "<p>У рейтингу поки немає учасників.</p>"
    : "<p>Увійдіть, щоб побачити рейтинг групи.</p>";
}
function switchView(name, remember = true) {
  document.body.classList.toggle("tracker-open", name === "tracker");
  document.body.classList.toggle("cards-open", name === "cards");
  document.body.classList.toggle("vocabulary-open", name === "vocabulary");
  $$(".view").forEach((v) =>
    v.classList.toggle("active", v.id === `${name}View`),
  );
  $$(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.view === name),
  );
  $$(".bottom-nav button").forEach((b) =>
    b.classList.toggle("active", b.dataset.bottomView === name),
  );
  if (name === "review") startReview(false);
  if (remember) persistUiState(name);
  trackPresence();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function parseCardParts(raw) {
  return raw
    .split(/\r?\n§§§\r?\n/)
    .filter(Boolean)
    .map((part) => {
      const split = part.indexOf("\t");
      if (split < 0) return null;
      const uk = part.slice(0, split).trim();
      const de = part.slice(split + 1).trim();
      const match = uk.match(/Стаття\s+(\d+)/i);
      return match ? { n: +match[1], uk, de } : null;
    })
    .filter(Boolean);
}
function mergeCards(raw) {
  const grouped = new Map();
  parseCardParts(raw).forEach(({ n, uk, de }) => {
      const u = uk.replace(/^Стаття\s+\d+\.\s*/i, "");
      const g = de.replace(/^Artikel\s+\d+\.\s*/i, "");
      if (!grouped.has(n))
        grouped.set(n, { n, uk: `Стаття ${n}.`, de: `Artikel ${n}.` });
      grouped.get(n).uk += `\n${u}`;
      grouped.get(n).de += `\n${g}`;
    });
  return ARTICLES.map((n) => grouped.get(n)).filter(Boolean);
}
function splitBalanced(text, count) {
  if (count <= 1) return [text.trim()];
  const tokens = text.trim().match(/\S+\s*/g) || [];
  const pages = [];
  let offset = 0;
  for (let page = 0; page < count; page++) {
    const remainingPages = count - page;
    const remainingLength = tokens.slice(offset).reduce((sum, token) => sum + token.length, 0);
    const target = Math.ceil(remainingLength / remainingPages);
    let length = 0;
    const start = offset;
    while (offset < tokens.length && (length < target || offset === start)) {
      length += tokens[offset].length;
      offset++;
    }
    if (page < count - 1) {
      const minimum = target * 0.62;
      let candidateLength = length;
      let punctuationBreak = -1;
      for (let i = offset; i > start; i--) {
        if (/[.;!?]\s*$/.test(tokens[i - 1]) && !/^\d+\.\s*$/.test(tokens[i - 1]) && candidateLength >= minimum) {
          punctuationBreak = i;
          break;
        }
        candidateLength -= tokens[i - 1].length;
      }
      if (punctuationBreak > start) offset = punctuationBreak;
    }
    pages.push(tokens.slice(start, offset).join("").trim());
  }
  return pages;
}
function buildStudyCards(raw) {
  const limit = window.innerWidth <= 520
    ? 320
    : window.innerWidth <= 900
      ? 430
      : Math.max(600, Math.min(1700, Math.floor((window.innerHeight - 220) * 1.5)));
  const expanded = [];
  mergeCards(raw).forEach(({ n, uk, de }) => {
    const ukBody = uk.replace(/^Стаття\s+\d+\.\s*/i, "");
    const deBody = de.replace(/^Artikel\s+\d+\.\s*/i, "");
    const pages = Math.max(1, Math.ceil(Math.max(ukBody.length, deBody.length) / limit));
    const ukPages = splitBalanced(ukBody, pages);
    const dePages = splitBalanced(deBody, pages);
    for (let i = 0; i < pages; i++)
      expanded.push({ n, uk: `Стаття ${n}.\n${ukPages[i]}`, de: `Artikel ${n}.\n${dePages[i]}` });
  });
  const totals = expanded.reduce((map, card) => map.set(card.n, (map.get(card.n) || 0) + 1), new Map());
  const seen = new Map();
  return expanded.map((card) => ({
    ...card,
    part: seen.set(card.n, (seen.get(card.n) || 0) + 1).get(card.n),
    parts: totals.get(card.n),
  }));
}
async function loadCards() {
  try {
    const raw = await fetch("cards.txt?v=9").then((r) => {
        if (!r.ok) throw Error();
        return r.text();
      });
    cards = mergeCards(raw);
    studyCards = buildStudyCards(raw);
    order = studyCards.map((_, i) => i);
    renderArticles();
    renderCard();
  } catch (e) {
    $("#cardUk").textContent =
      "Не вдалося завантажити картки. Оновіть сторінку.";
  }
}
async function loadVocabulary() {
  try {
    const raw = await fetch("vocabulary.txt?v=1").then((r) => {
      if (!r.ok) throw Error();
      return r.text();
    });
    vocabulary = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line, id) => {
        const [uk, de] = line.split("\t");
        return { id, uk: uk?.trim(), de: de?.trim() };
      })
      .filter((word) => word.uk && word.de);
    vocabOrder = vocabulary.map((word) => word.id);
    vocabIndex = 0;
    renderVocabulary();
  } catch (e) {
    $("#vocabUk").textContent = "Не вдалося завантажити слова.";
  }
}
function restoreUiState() {
  const validViews = new Set([
    "tracker",
    "cards",
    "vocabulary",
    "review",
    "ranking",
    "account",
  ]);
  if (
    Array.isArray(savedUi.articleOrder) &&
    savedUi.articleOrder.length === studyCards.length &&
    savedUi.articleOrder.every(
      (index) => Number.isInteger(index) && index >= 0 && index < studyCards.length,
    )
  )
    order = [...savedUi.articleOrder];
  const articlePosition = order.findIndex(
    (index) => studyCards[index]?.n === savedUi.article &&
      (!savedUi.articlePart || studyCards[index]?.part === savedUi.articlePart),
  );
  if (articlePosition >= 0) cardIndex = articlePosition;
  if (
    Array.isArray(savedUi.vocabOrder) &&
    savedUi.vocabOrder.length === vocabulary.length &&
    savedUi.vocabOrder.every(
      (id) => Number.isInteger(id) && id >= 0 && id < vocabulary.length,
    )
  )
    vocabOrder = [...new Set(savedUi.vocabOrder)];
  const vocabPosition = vocabOrder.indexOf(savedUi.vocabId);
  if (vocabPosition >= 0) vocabIndex = vocabPosition;
  vocabLearnMode = Boolean(savedUi.vocabLearnMode);
  vocabGermanFirst = Boolean(savedUi.vocabGermanFirst);
  vocabShuffleAnchorId = Number.isInteger(savedUi.vocabShuffleAnchorId)
    ? savedUi.vocabShuffleAnchorId
    : null;
  const view = validViews.has(savedUi.view) ? savedUi.view : "tracker";
  uiRestored = true;
  switchView(view, true);
  renderCard();
  renderVocabulary();
}
function currentVocab() {
  return vocabulary[vocabOrder[vocabIndex]];
}
function renderVocabulary() {
  if (!vocabulary.length) return;
  vocabIndex = Math.max(0, Math.min(vocabIndex, vocabOrder.length - 1));
  const word = currentVocab();
  const frontText = vocabGermanFirst ? word.de : word.uk;
  const backText = vocabGermanFirst ? word.uk : word.de;
  $("#vocabUk").textContent = frontText;
  $("#vocabDe").textContent = backText;
  $("#vocabFrontLabel").textContent = vocabGermanFirst ? "Deutsch" : "Українська";
  $("#vocabBackLabel").textContent = vocabGermanFirst ? "Українська" : "Deutsch";
  [[$("#vocabUk"), frontText], [$("#vocabDe"), backText]].forEach(([element, text]) => {
    element.classList.toggle("term-single-line", text.length <= 32);
    element.classList.toggle("term-long", text.length > 48);
  });
  $("#vocabCard").classList.toggle("flipped", vocabFlipped);
  $("#vocabCard .vocab-card-inner").style.transform = `rotateX(${vocabRotation}deg)`;
  $("#vocabLearnMode").checked = vocabLearnMode;
  const learnedCount = state.vocabLearned.filter((id) => id < vocabulary.length).length;
  $("#vocabLearningStats").hidden = !vocabLearnMode;
  $("#vocabLearnedCount").textContent = learnedCount;
  $("#vocabRemainingCount").textContent = vocabulary.length - learnedCount;
  const shuffled = vocabOrder.some((id, index) => id !== index);
  $("#vocabShuffle").classList.toggle("state-on", shuffled);
  $("#vocabShuffle").setAttribute("aria-pressed", String(shuffled));
  $("#vocabShuffle").setAttribute(
    "title",
    shuffled ? "Вимкнути перемішування" : "Перемішати",
  );
  $("#vocabShuffle").setAttribute(
    "aria-label",
    shuffled ? "Вимкнути перемішування" : "Перемішати",
  );
  $("#vocabShuffleLabel").textContent = shuffled ? "Перемішування увімкнено" : "Перемішати";
  $("#vocabShuffleHint").textContent = shuffled
    ? "Натисніть, щоб повернути звичайний порядок"
    : "Змінити порядок усіх слів";
  $("#vocabCounter").textContent = `${vocabIndex + 1} / ${vocabOrder.length}`;
  $("#vocabPrev").disabled = !vocabLearnMode && vocabIndex === 0;
  $("#vocabPrev").setAttribute(
    "aria-label",
    vocabLearnMode ? "Ще вчу" : "Попереднє слово",
  );
  $("#vocabPrev").title = vocabLearnMode
    ? "Ще вчу"
    : "Попереднє слово";
  $("#vocabNext").setAttribute(
    "aria-label",
    vocabLearnMode ? "Вивчено" : "Наступне слово",
  );
  $("#vocabNext").title = vocabLearnMode ? "Вивчено" : "Наступне слово";
  $("#vocabNext").disabled = !vocabLearnMode && vocabIndex === vocabOrder.length - 1;
  const canUndoVocabulary = vocabLearnMode && vocabUndoStack.length > 0;
  $("#vocabUndo").disabled = !canUndoVocabulary;
  $("#vocabUndo").title = canUndoVocabulary
    ? "Скасувати останню відповідь"
    : "Поки немає дій для скасування";
  renderVocabularyList();
  persistUiState();
}
function renderVocabularyList() {
  if (!vocabulary.length) return;
  const shown = vocabulary;
  $("#vocabShown").textContent = `${shown.length} слів`;
  $("#vocabList").innerHTML = shown
    .map(
      (word) =>
        `<button class="vocab-row" data-vocab-id="${word.id}"><span>${safe(word.uk)}</span><strong>${safe(word.de)}</strong></button>`,
    )
    .join("");
}
function moveVocabulary(step, animate = true) {
  const previousDecision = vocabLearnMode
    ? {
        id: currentVocab().id,
        index: vocabIndex,
        wasLearned: state.vocabLearned.includes(currentVocab().id),
      }
    : null;
  let learningChanged = false;
  if (vocabLearnMode) {
    const id = currentVocab().id;
    const learned = state.vocabLearned.includes(id);
    if (step > 0 && !learned) {
      state.vocabLearned.push(id);
      learningChanged = true;
    }
    if (step < 0 && learned) {
      state.vocabLearned = state.vocabLearned.filter((wordId) => wordId !== id);
      learningChanged = true;
    }
  }
  const nextStep = vocabLearnMode ? 1 : step;
  const next = Math.max(0, Math.min(vocabIndex + nextStep, vocabOrder.length - 1));
  if (next === vocabIndex && !learningChanged) return;
  if (previousDecision) {
    vocabUndoStack.push(previousDecision);
    if (vocabUndoStack.length > 50) vocabUndoStack.shift();
  }
  const inner = $("#vocabCard .vocab-card-inner");
  const resetFace = vocabFlipped;
  if (resetFace) inner.style.transition = "none";
  vocabIndex = next;
  vocabFlipped = false;
  vocabRotation = 0;
  if (learningChanged) save();
  else renderVocabulary();
  if (resetFace) {
    void inner.offsetWidth;
    inner.style.removeProperty("transition");
  }
  if (animate) animateStudyCard($("#vocabCard"), step);
}
function undoVocabularyDecision() {
  if (vocabSwipeAnimating || !vocabUndoStack.length) return;
  const previous = vocabUndoStack.pop();
  if (previous.wasLearned && !state.vocabLearned.includes(previous.id))
    state.vocabLearned.push(previous.id);
  if (!previous.wasLearned)
    state.vocabLearned = state.vocabLearned.filter((id) => id !== previous.id);
  vocabIndex = Math.max(0, Math.min(previous.index, vocabOrder.length - 1));
  vocabFlipped = false;
  vocabRotation = 0;
  save();
  const card = $("#vocabCard");
  card.animate(
    [
      { transform: "translateX(-24px)", opacity: 0.35 },
      { transform: "translateX(0)", opacity: 1 },
    ],
    { duration: 180, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
  );
}
function clearVocabularyDrag() {
  const card = $("#vocabCard");
  const tint = card.querySelector(".vocab-swipe-tint");
  card.style.removeProperty("transform");
  card.classList.remove("is-dragging");
  tint.style.removeProperty("opacity");
  tint.classList.remove("is-known", "is-learning");
}
async function settleVocabularyDrag() {
  const card = $("#vocabCard");
  const tint = card.querySelector(".vocab-swipe-tint");
  const from = card.style.transform || "translateX(0) rotate(0deg)";
  vocabSwipeAnimating = true;
  const cardAnimation = card.animate(
    [{ transform: from }, { transform: "translateX(0) rotate(0deg)" }],
    { duration: 180, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
  );
  const tintAnimation = tint.animate(
    [{ opacity: Number(tint.style.opacity || 0) }, { opacity: 0 }],
    { duration: 140, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
  );
  clearVocabularyDrag();
  try { await Promise.all([cardAnimation.finished, tintAnimation.finished]); } catch {}
  vocabSwipeAnimating = false;
}
async function animateVocabularyDecision(step, fast = false) {
  if (vocabSwipeAnimating) return;
  const card = $("#vocabCard");
  const tint = card.querySelector(".vocab-swipe-tint");
  const direction = step > 0 ? 1 : -1;
  vocabSwipeAnimating = true;
  tint.classList.toggle("is-known", direction > 0);
  tint.classList.toggle("is-learning", direction < 0);
  const from = card.style.transform || "translateX(0) rotate(0deg)";
  const exit = card.animate(
    [
      { transform: from, opacity: 1 },
      { transform: `translateX(${direction * 118}%) rotate(${direction * 9}deg)`, opacity: 0.18 },
    ],
    { duration: fast ? 135 : 220, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" },
  );
  const tintExit = tint.animate(
    [{ opacity: Number(tint.style.opacity || 0.2) }, { opacity: 0.72 }],
    { duration: fast ? 90 : 150, easing: "ease-out", fill: "forwards" },
  );
  try { await exit.finished; } catch {}
  moveVocabulary(step, false);
  exit.cancel();
  tintExit.cancel();
  clearVocabularyDrag();
  const enter = card.animate(
    [
      { transform: `translateX(${-direction * 28}px)`, opacity: 0 },
      { transform: "translateX(0)", opacity: 1 },
    ],
    { duration: fast ? 105 : 180, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
  );
  try { await enter.finished; } catch {}
  vocabSwipeAnimating = false;
}
function flipVocabulary(direction = 1) {
  vocabFlipped = !vocabFlipped;
  vocabRotation += direction * 180;
  if (!vocabLearnMode && vocabFlipped && !state.vocabLearned.includes(currentVocab().id)) {
    state.vocabLearned.push(currentVocab().id);
    save();
  } else renderVocabulary();
}
function currentCard() {
  return studyCards[order[cardIndex]];
}
function renderCard() {
  if (!studyCards.length) return;
  cardIndex = Math.max(0, Math.min(cardIndex, order.length - 1));
  const c = currentCard();
  $("#cardUk").textContent = c.uk;
  $("#cardDe").textContent = c.de;
  $("#cardUk").classList.toggle("is-compact", c.uk.length > 300);
  $("#cardDe").classList.toggle("is-compact", c.de.length > 300);
  $("#flashcard").classList.toggle("flipped", flipped);
  $("#flashcard .flashcard-inner").style.transform = `rotateX(${cardRotation}deg)`;
  $("#cardCounter").textContent = `Стаття ${c.n}${c.parts > 1 ? ` · ${c.part}/${c.parts}` : ""} · ${cardIndex + 1}/${order.length}${cardIndex === 0 ? " · початок" : cardIndex === order.length - 1 ? " · кінець" : ""}`;
  $("#prevArticle").disabled = cardIndex === 0;
  $("#nextArticle").disabled = cardIndex === order.length - 1;
  $("#prevArticle").title =
    cardIndex === 0 ? "Це перша картка" : "Попередня картка";
  $("#nextArticle").title =
    cardIndex === order.length - 1 ? "Це остання картка" : "Наступна картка";
  const learned = has("learned", c.n);
  const review = has("review", c.n);
  const hard = state.difficulty[c.n] === "hard";
  $("#cardLearned").textContent = learned ? "Вивчено ✓" : "Вивчено";
  $("#cardLearned").classList.toggle("state-on", learned);
  $("#cardReview").textContent = review ? "Повторити ✓" : "Повторити";
  $("#cardReview").classList.toggle("state-on", review);
  const hardButton = $("#cardsView [data-level='hard']");
  hardButton.textContent = hard ? "Складна ✓" : "Складна";
  hardButton.classList.toggle("state-on", hard);
  trackPresence();
  persistUiState();
}
function flipCard(direction = 1) {
  flipped = !flipped;
  cardRotation += direction * 180;
  renderCard();
}
function animateStudyCard(element, step) {
  element.animate(
    [
      {
        opacity: 0.35,
        transform: `translateX(${step > 0 ? "18px" : "-18px"})`,
      },
      { opacity: 1, transform: "translateX(0)" },
    ],
    { duration: 140, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
  );
}
function animateCard(step) {
  animateStudyCard($("#flashcard"), step);
}
function moveCard(step) {
  const next = Math.max(0, Math.min(cardIndex + step, order.length - 1));
  if (next === cardIndex) return;
  const inner = $("#flashcard .flashcard-inner");
  const resetFace = flipped;
  if (resetFace) inner.style.transition = "none";
  cardIndex = next;
  flipped = false;
  cardRotation = 0;
  renderCard();
  if (resetFace) {
    void inner.offsetWidth;
    inner.style.removeProperty("transition");
  }
  animateCard(step);
}
function openArticle(n) {
  order = studyCards.map((_, i) => i);
  cardIndex = Math.max(
    0,
    studyCards.findIndex((c) => c.n === n),
  );
  flipped = false;
  cardRotation = 0;
  switchView("cards");
  renderCard();
}
function startReview(all) {
  const articleIds = (
    all ? ARTICLES.filter((n) => has("learned", n)) : dueArticles()
  ).filter((n) => studyCards.some((c) => c.n === n));
  reviewQueue = studyCards.filter((card) => articleIds.includes(card.n));
  reviewIndex = 0;
  reviewFlipped = false;
  reviewResults = new Map();
  $("#reviewEmpty").hidden = reviewQueue.length > 0;
  $("#reviewSession").hidden = !reviewQueue.length;
  if (reviewQueue.length) renderReviewCard();
}
function renderReviewCard() {
  const c = reviewQueue[reviewIndex],
    n = c.n;
  $("#reviewUk").textContent = c.uk;
  $("#reviewDe").textContent = c.de;
  $("#reviewUk").classList.toggle("is-compact", c.uk.length > 300);
  $("#reviewDe").classList.toggle("is-compact", c.de.length > 300);
  $("#reviewCard").classList.toggle("flipped", reviewFlipped);
  $("#reviewCounter").textContent =
    `${reviewIndex + 1} / ${reviewQueue.length} · Стаття ${n}${c.parts > 1 ? ` · частина ${c.part}/${c.parts}` : ""}`;
}
function finishReview(known) {
  const n = reviewQueue[reviewIndex].n;
  reviewResults.set(n, (reviewResults.get(n) ?? true) && known);
  const articleFinished = reviewIndex === reviewQueue.length - 1 || reviewQueue[reviewIndex + 1].n !== n;
  if (articleFinished) {
    if (reviewResults.get(n)) {
      toggle("review", n, false);
      const level = (state.reviewLevel[n] || 0) + 1;
      state.reviewLevel[n] = level;
      state.nextReview[n] = Date.now() + [1, 3, 7, 14][Math.min(level, 3)] * DAY;
    } else {
      toggle("review", n, true);
      state.nextReview[n] = Date.now();
    }
  }
  save();
  reviewIndex++;
  reviewFlipped = false;
  if (reviewIndex >= reviewQueue.length) startReview(false);
  else renderReviewCard();
}
function tick() {
  const left = Math.max(0, DEADLINE - new Date()),
    vals = [
      Math.floor(left / DAY),
      Math.floor(left / 3600000) % 24,
      Math.floor(left / 60000) % 60,
      Math.floor(left / 1000) % 60,
    ];
  ["days", "hours", "minutes", "seconds"].forEach(
    (id, i) => ($(`#${id}`).textContent = String(vals[i]).padStart(2, "0")),
  );
}
$$(".tab").forEach((b) =>
  b.addEventListener("click", () => switchView(b.dataset.view)),
);
$("#homeBtn").addEventListener("click", () => {
  $("#search").value = "";
  renderArticles();
  switchView("tracker");
});
$$(".bottom-nav button").forEach((b) =>
  b.addEventListener("click", () => switchView(b.dataset.bottomView)),
);
$("#accountAuth").addEventListener("click", openAuth);
$("#editName").addEventListener("click", () => {
  $("#authName").value =
    currentProfile?.display_name ||
    currentUser?.user_metadata?.display_name ||
    "";
  setAuthMode("profile");
  openAuth();
});
$("#accountTheme").addEventListener("click", () =>
  applyTheme(
    document.documentElement.dataset.theme === "dark" ? "light" : "dark",
  ),
);
$("#avatarPicker").addEventListener("click", (e) => {
  const button = e.target.closest("[data-avatar]");
  if (!button) return;
  state.profileAvatar = button.dataset.avatar;
  lastPresenceSignature = "";
  save(false);
  renderAuthStatus();
  trackPresence(true);
  $("#avatarDialog").close();
});
$("#editAvatar").addEventListener("click", () => $("#avatarDialog").showModal());
$("#avatarUpload").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
    alert("Оберіть зображення до 8 МБ.");
    e.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      const sx = (image.naturalWidth - side) / 2;
      const sy = (image.naturalHeight - side) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 192;
      const context = canvas.getContext("2d");
      context.drawImage(image, sx, sy, side, side, 0, 0, 192, 192);
      state.customAvatar = canvas.toDataURL("image/webp", 0.78);
      state.profileAvatar = "custom";
      lastPresenceSignature = "";
      save(false);
      renderAuthStatus();
      trackPresence(true);
      e.target.value = "";
      $("#avatarDialog").close();
    };
    image.onerror = () => alert("Не вдалося прочитати це зображення.");
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
});
$("#cardStylePicker").addEventListener("click", (e) => {
  const button = e.target.closest("[data-card-style]");
  if (!button) return;
  state.cardStyle = button.dataset.cardStyle;
  lastPresenceSignature = "";
  save(false);
  trackPresence(true);
});
$("#leaderboardList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-profile]");
  if (!b) return;
  const p = groupProfiles.find((x) => x.user_id === b.dataset.profile);
  if (!p) return;
  const rank = groupProfiles.indexOf(p) + 1;
  const presence = onlineStudy.get(p.user_id);
  const profileAvatar = presence?.avatar || p.avatar || (p.user_id === currentUser?.id ? state.profileAvatar : "avatar-03");
  const profileCustomAvatar = presence?.custom_avatar || p.custom_avatar || (p.user_id === currentUser?.id ? state.customAvatar : "");
  const savedProfileCardStyle = presence?.card_style || p.card_style;
  const profileCardStyle = CARD_STYLES.includes(savedProfileCardStyle) ? savedProfileCardStyle : (p.user_id === currentUser?.id ? state.cardStyle : "classic");
  $("#profileDialog").dataset.profileStyle = profileCardStyle;
  $("#profileAvatar").innerHTML = avatarMarkup(profileAvatar, profileCustomAvatar);
  $("#profileName").textContent = p.display_name;
  $("#profileRank").textContent = `№ ${rank}`;
  $("#profileLearned").textContent = `${p.learned_count} / 39`;
  $("#profileHard").textContent = p.hard_count;
  $("#profileStreak").textContent = `${p.streak} днів`;
  $("#profileDialog").showModal();
});
$("#search").addEventListener("input", renderArticles);
$("#filterRow").addEventListener("click", (e) => {
  const button = e.target.closest("[data-filter]");
  if (!button) return;
  articleFilter = button.dataset.filter;
  $$("#filterRow [data-filter]").forEach((b) =>
    b.classList.toggle("active", b === button),
  );
  renderArticles();
});
$("#vocabList").addEventListener("click", (e) => {
  const row = e.target.closest("[data-vocab-id]");
  if (!row) return;
  const id = +row.dataset.vocabId;
  vocabOrder = vocabulary.map((word) => word.id);
  vocabIndex = vocabOrder.indexOf(id);
  vocabUndoStack = [];
  vocabFlipped = false;
  vocabRotation = 0;
  renderVocabulary();
  $("#vocabCard").scrollIntoView({ behavior: "smooth", block: "center" });
});
$("#vocabCard").addEventListener("click", () => {
  if (vocabSwipeHandled) {
    vocabSwipeHandled = false;
    return;
  }
  flipVocabulary();
});
$("#vocabCard").addEventListener("pointerdown", (event) => {
  if (vocabSwipeAnimating) return;
  vocabPointerStart = {
    x: event.clientX,
    y: event.clientY,
    time: performance.now(),
    pointerId: event.pointerId,
  };
  if (vocabLearnMode) event.currentTarget.setPointerCapture(event.pointerId);
});
$("#vocabCard").addEventListener("pointermove", (event) => {
  if (!vocabLearnMode || !vocabPointerStart || vocabSwipeAnimating) return;
  const dx = event.clientX - vocabPointerStart.x;
  const dy = event.clientY - vocabPointerStart.y;
  if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) return;
  const card = event.currentTarget;
  const tint = card.querySelector(".vocab-swipe-tint");
  const progress = Math.min(Math.abs(dx) / Math.max(card.offsetWidth * 0.42, 1), 1);
  card.classList.add("is-dragging");
  card.style.transform = `translateX(${dx}px) rotate(${dx / card.offsetWidth * 7}deg)`;
  tint.classList.toggle("is-known", dx > 0);
  tint.classList.toggle("is-learning", dx < 0);
  tint.style.opacity = String(progress * 0.62);
});
$("#vocabCard").addEventListener("pointerup", (event) => {
  if (!vocabPointerStart) return;
  const dx = event.clientX - vocabPointerStart.x;
  const dy = event.clientY - vocabPointerStart.y;
  const elapsed = Math.max(performance.now() - vocabPointerStart.time, 1);
  const velocity = Math.abs(dx) / elapsed;
  vocabPointerStart = null;
  if (event.currentTarget.hasPointerCapture(event.pointerId))
    event.currentTarget.releasePointerCapture(event.pointerId);
  if (Math.abs(dx) <= Math.abs(dy)) {
    if (vocabLearnMode) settleVocabularyDrag();
    return;
  }
  if (Math.abs(dx) > 8) {
    vocabSwipeHandled = true;
    setTimeout(() => { vocabSwipeHandled = false; }, 0);
  }
  const accepted = Math.abs(dx) >= 72 || (Math.abs(dx) >= 24 && velocity > 0.45);
  if (!accepted) {
    if (vocabLearnMode) settleVocabularyDrag();
    return;
  }
  if (vocabLearnMode) animateVocabularyDecision(dx > 0 ? 1 : -1);
  else moveVocabulary(dx < 0 ? 1 : -1);
});
$("#vocabCard").addEventListener("pointercancel", () => {
  vocabPointerStart = null;
  if (vocabLearnMode) settleVocabularyDrag();
});
$("#vocabPrev").addEventListener("click", () =>
  vocabLearnMode ? animateVocabularyDecision(-1, true) : moveVocabulary(-1),
);
$("#vocabNext").addEventListener("click", () =>
  vocabLearnMode ? animateVocabularyDecision(1, true) : moveVocabulary(1),
);
$("#vocabUndo").addEventListener("click", undoVocabularyDecision);
$("#vocabSettingsOpen").addEventListener("click", () => $("#vocabSettingsDialog").showModal());
$("#vocabLearnMode").addEventListener("change", (event) => {
  vocabLearnMode = event.target.checked;
  vocabUndoStack = [];
  renderVocabulary();
});
$("#vocabShuffle").addEventListener("click", () => {
  const currentId = currentVocab().id;
  const shuffled = vocabOrder.some((id, index) => id !== index);
  vocabOrder = vocabulary.map((word) => word.id);
  if (!shuffled) {
    vocabShuffleAnchorId = currentId;
    for (let i = vocabOrder.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [vocabOrder[i], vocabOrder[j]] = [vocabOrder[j], vocabOrder[i]];
    }
    vocabIndex = 0;
  } else {
    const returnId = Number.isInteger(vocabShuffleAnchorId)
      ? vocabShuffleAnchorId
      : currentId;
    vocabIndex = vocabOrder.indexOf(returnId);
    vocabShuffleAnchorId = null;
  }
  vocabFlipped = false;
  vocabRotation = 0;
  renderVocabulary();
});
$("#vocabSwap").addEventListener("click", () => {
  vocabGermanFirst = !vocabGermanFirst;
  vocabFlipped = false;
  vocabRotation = 0;
  renderVocabulary();
});
$("#vocabRestart").addEventListener("click", () => {
  vocabIndex = 0;
  vocabFlipped = false;
  vocabRotation = 0;
  renderVocabulary();
  $("#vocabCard").scrollIntoView({ behavior: "smooth", block: "center" });
});
$("#vocabReset").addEventListener("click", () => {
  if (!confirm("Скинути весь прогрес для 150 слів?")) return;
  state.vocabLearned = [];
  vocabIndex = 0;
  vocabFlipped = false;
  vocabRotation = 0;
  save();
});
$("#todayList").addEventListener("click", (e) => {
  const button = e.target.closest("[data-today-article]");
  if (button) openArticle(+button.dataset.todayArticle);
});
$("#articleGrid").addEventListener("click", (e) => {
  const a = e.target.closest(".article");
  if (!a) return;
  const n = +a.dataset.n;
  if (e.target.closest("[data-level]"))
    setDifficulty(n, e.target.closest("[data-level]").dataset.level);
  else if (e.target.closest(".learn-toggle")) learn(n);
  else if (e.target.closest(".review-toggle")) markReview(n);
  else if (e.target.closest(".note-toggle")) {
    noteArticle = n;
    $("#noteTitle").textContent = `Стаття ${n}`;
    $("#noteText").value = state.notes[n] || "";
    $("#noteDialog").showModal();
  } else openArticle(n);
});
$("#articleGrid").addEventListener("keydown", (e) => {
  if (
    (e.key === "Enter" || e.key === " ") &&
    e.target.classList.contains("article")
  ) {
    e.preventDefault();
    openArticle(+e.target.dataset.n);
  }
});
$("#noteDialog").addEventListener("close", () => {
  if ($("#noteDialog").returnValue === "save") {
    const v = $("#noteText").value.trim();
    if (v) state.notes[noteArticle] = v;
    else delete state.notes[noteArticle];
    save();
  }
});
$("#flashcard").addEventListener("click", () => {
  if (cardSwipeHandled) {
    cardSwipeHandled = false;
    return;
  }
  flipCard(1);
});
$("#flashcard").addEventListener("pointerdown", (event) => {
  cardPointerStart = { x: event.clientX, y: event.clientY };
});
$("#flashcard").addEventListener("pointerup", (event) => {
  if (!cardPointerStart) return;
  const dx = event.clientX - cardPointerStart.x;
  const dy = event.clientY - cardPointerStart.y;
  cardPointerStart = null;
  if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy)) return;
  cardSwipeHandled = true;
  moveCard(dx < 0 ? 1 : -1);
});
$("#flashcard").addEventListener("pointercancel", () => {
  cardPointerStart = null;
});
$("#prevArticle").addEventListener("click", () => moveCard(-1));
$("#nextArticle").addEventListener("click", () => moveCard(1));
$("#shuffleBtn").addEventListener("click", () => {
  const articles = [...new Set(studyCards.map((card) => card.n))].sort(() => Math.random() - 0.5);
  order = articles.flatMap((n) => studyCards.map((card, index) => card.n === n ? index : -1).filter((index) => index >= 0));
  cardIndex = 0;
  flipped = false;
  cardRotation = 0;
  renderCard();
});
$("#cardLearned").addEventListener("click", () => learn(currentCard().n));
$("#cardReview").addEventListener("click", () => markReview(currentCard().n));
$$("#cardsView [data-level]").forEach((b) =>
  b.addEventListener("click", () =>
    setDifficulty(currentCard().n, b.dataset.level),
  ),
);
$("#startToday").addEventListener("click", () => {
  const todo = todayPlan();
  order = todo.flatMap((n) =>
    studyCards.map((card, index) => card.n === n ? index : -1).filter((index) => index >= 0),
  );
  if (!order.length) order = studyCards.map((_, i) => i);
  cardIndex = 0;
  flipped = false;
  cardRotation = 0;
  switchView("cards");
  renderCard();
});
$("#fullscreenCard").addEventListener("click", async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await $("#cardsView").requestFullscreen();
});
document.addEventListener("fullscreenchange", () => {
  $("#fullscreenCard").textContent = document.fullscreenElement
    ? "Згорнути"
    : "На весь екран";
});
$("#reviewCard").addEventListener("click", () => {
  if (reviewSwipeHandled) {
    reviewSwipeHandled = false;
    return;
  }
  reviewFlipped = !reviewFlipped;
  renderReviewCard();
});
$("#reviewCard").addEventListener("pointerdown", (event) => {
  reviewPointerStart = { x: event.clientX, y: event.clientY };
});
$("#reviewCard").addEventListener("pointerup", (event) => {
  if (!reviewPointerStart) return;
  const dx = event.clientX - reviewPointerStart.x;
  const dy = event.clientY - reviewPointerStart.y;
  reviewPointerStart = null;
  if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy)) return;
  reviewSwipeHandled = true;
  finishReview(dx > 0);
});
$("#reviewCard").addEventListener("pointercancel", () => {
  reviewPointerStart = null;
});
$("#reviewAgain").addEventListener("click", () => finishReview(false));
$("#reviewKnown").addEventListener("click", () => finishReview(true));
$("#reviewAll").addEventListener("click", () => startReview(true));
$("#resetBtn").addEventListener("click", () => {
  if (confirm("Скинути весь прогрес, статуси й нотатки?")) {
    state = blankState();
    save(false);
  }
});
function openAuth() {
  if (!(currentUser && authMode === "profile")) renderAuthStatus();
  $("#authMessage").textContent = "";
  if (!$("#authDialog").open) $("#authDialog").showModal();
}
$("#authBtn").addEventListener("click", () => switchView("account"));
$("#themeBtn").addEventListener("click", () =>
  applyTheme(
    document.documentElement.dataset.theme === "dark" ? "light" : "dark",
  ),
);
$("#closeAuth").addEventListener("click", () => $("#authDialog").close());
$("#authMode").addEventListener("click", () =>
  setAuthMode(authMode === "signin" ? "signup" : "signin"),
);
$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (authMode === "profile") {
    const name = $("#authName").value.trim();
    if (name.length < 2) {
      $("#authMessage").textContent = "Вкажіть ім’я щонайменше з 2 символів.";
      return;
    }
    $("#authSubmit").disabled = true;
    $("#authMessage").textContent = "Зберігаю ім’я…";
    const error = await saveGroupProfile(name);
    $("#authSubmit").disabled = false;
    if (error) {
      $("#authMessage").textContent = error.message;
      return;
    }
    authMode = "signin";
    $("#authDialog").close();
    renderAuthStatus();
    return;
  }
  const email = $("#authEmail").value.trim(),
    password = $("#authPassword").value,
    displayName = $("#authName").value.trim();
  if (!email || password.length < 8) {
    $("#authMessage").textContent =
      "Вкажіть email і пароль щонайменше з 8 символів.";
    return;
  }
  if (authMode === "signup" && displayName.length < 2) {
    $("#authMessage").textContent = "Вкажіть ім’я щонайменше з 2 символів.";
    return;
  }
  $("#authSubmit").disabled = true;
  $("#authMessage").textContent = "Зачекайте…";
  const result =
    authMode === "signin"
      ? await client.auth.signInWithPassword({ email, password })
      : await client.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName },
            emailRedirectTo:
              "https://vitthegrandfather.github.io/un-charter-checklist/",
          },
        });
  $("#authSubmit").disabled = false;
  if (result.error) {
    $("#authMessage").textContent = authErrorText(result.error);
    return;
  }
  if (authMode === "signup" && !result.data.session) {
    $("#authMessage").textContent =
      "Перевірте пошту та підтвердьте реєстрацію.";
  } else {
    $("#authDialog").close();
    await useSession(result.data.session);
  }
});
$("#signOutBtn").addEventListener("click", async () => {
  await stopRealtime();
  await client.auth.signOut();
  currentUser = null;
  currentProfile = null;
  groupProfiles = [];
  state = blankState();
  localStorage.removeItem(KEY);
  localStorage.removeItem(OLD_KEY);
  $("#authDialog").close();
  renderAuthStatus();
  renderAll();
});
document.addEventListener("keydown", (e) => {
  if (
    $("#vocabularyView").classList.contains("active") &&
    !["INPUT", "TEXTAREA"].includes(e.target.tagName)
  ) {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key))
      e.preventDefault();
    if (e.key === "ArrowLeft")
      vocabLearnMode ? animateVocabularyDecision(-1, true) : moveVocabulary(-1);
    if (e.key === "ArrowRight")
      vocabLearnMode ? animateVocabularyDecision(1, true) : moveVocabulary(1);
    if (e.key === "ArrowUp") flipVocabulary(-1);
    if (e.key === "ArrowDown" || e.code === "Space") flipVocabulary(1);
    return;
  }
  if (
    !$("#cardsView").classList.contains("active") ||
    ["INPUT", "TEXTAREA"].includes(e.target.tagName)
  )
    return;
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))
    e.preventDefault();
  if (e.key === "ArrowLeft") moveCard(-1);
  if (e.key === "ArrowRight") moveCard(1);
  if (e.key === "ArrowUp") flipCard(-1);
  if (e.key === "ArrowDown") flipCard(1);
  if (e.code === "Space") {
    e.preventDefault();
    flipCard(1);
  }
});
applyTheme(document.documentElement.dataset.theme || "light");
renderAll();
renderAuthStatus();
tick();
setInterval(tick, 1000);
Promise.all([loadCards(), loadVocabulary()]).then(restoreUiState);
if (client) {
  client.auth.getSession().then(async ({ data }) => {
    await useSession(data.session);
    if (!data.session && !localStorage.getItem(AUTH_PROMPT_KEY)) {
      localStorage.setItem(AUTH_PROMPT_KEY, "1");
      setTimeout(openAuth, 500);
    }
  });
  client.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session?.user?.id !== currentUser?.id)
      setTimeout(() => useSession(session), 0);
    if (event === "SIGNED_OUT") {
      stopRealtime();
      currentUser = null;
      renderAuthStatus();
    }
  });
}

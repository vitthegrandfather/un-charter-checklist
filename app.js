const ARTICLES = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17, 18, 20, 22, 23, 24, 27, 28, 32, 33, 34,
  41, 42, 43, 45, 50, 51, 55, 61, 62, 75, 92, 97, 98, 102, 103, 110, 111,
];
const OLD_KEY = "un-charta-progress-v1",
  KEY = "un-charta-study-v2",
  THEME_KEY = "un-charta-theme-v1",
  AUTH_PROMPT_KEY = "un-charta-auth-prompt-seen-v1",
  DEADLINE = new Date("2026-10-12T00:00:00+03:00"),
  DAY = 86400000,
  REVIEW_DAYS = 4;
const SUPABASE_URL = "https://xwdxfbgazlplyiglzecm.supabase.co",
  SUPABASE_KEY = "sb_publishable_yNV81pVLwznAKRN2fH3PBQ_ptbNVmFh";
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
});
function normalize(raw = {}) {
  const s = Object.assign(blankState(), raw);
  ["learned", "review", "hard", "studyDates"].forEach(
    (k) => (s[k] = Array.isArray(s[k]) ? s[k] : []),
  );
  s.difficulty =
    s.difficulty && typeof s.difficulty === "object" ? s.difficulty : {};
  s.dailyPlans =
    s.dailyPlans && typeof s.dailyPlans === "object" ? s.dailyPlans : {};
  s.hard.forEach((n) => {
    if (!s.difficulty[n]) s.difficulty[n] = "hard";
  });
  return s;
}
const oldLearned = JSON.parse(localStorage.getItem(OLD_KEY) || "[]");
let state = normalize(
  Object.assign(
    { learned: oldLearned },
    JSON.parse(localStorage.getItem(KEY) || "{}"),
  ),
);
let cards = [],
  order = [],
  cardIndex = 0,
  flipped = false,
  noteArticle = null,
  reviewQueue = [],
  reviewIndex = 0,
  reviewFlipped = false,
  currentUser = null,
  cloudTimer = null,
  authMode = "signin",
  currentProfile = null,
  groupProfiles = [],
  onlineStudy = new Map(),
  realtimeChannel = null,
  lastPresenceSignature = "",
  articleFilter = "all";
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
    .select("user_id,display_name,learned_count,hard_count,streak,updated_at")
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
  const article = cardsOpen && cards.length ? currentCard()?.n || null : null;
  const signature = `${currentUser.id}:${article || "online"}`;
  if (!force && signature === lastPresenceSignature) return;
  lastPresenceSignature = signature;
  await realtimeChannel.track({
    user_id: currentUser.id,
    article,
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
    $("#authBtn").textContent = "Акаунт ✓";
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
  $("#progressBar").style.width = `${(done / ARTICLES.length) * 100}%`;
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
  $("#editName").hidden = !currentUser;
  $("#accountSync").textContent = currentUser
    ? "Синхронізація між пристроями активна ✓"
    : "Прогрес зберігається лише на цьому пристрої";
  $("#accountLead").textContent = currentUser
    ? "Ваш прогрес збережений і бере участь у рейтингу."
    : "Увійдіть, щоб зберігати навчання у хмарі та бачити групу.";
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
                : presence
                  ? "Зараз на сайті"
                  : "";
              return `<button class="leader-row${presence ? " is-online" : ""}" data-profile="${p.user_id}"><b>${i + 1}</b><span><strong>${safe(p.display_name)}${presence ? '<i class="online-dot" aria-label="Онлайн"></i>' : ""}</strong><small>${p.learned_count} з 39 статей${liveText ? ` · <mark>${liveText}</mark>` : ""}</small></span><em>${p.learned_count}</em></button>`;
            },
          )
          .join("")
      : "<p>У рейтингу поки немає учасників.</p>"
    : "<p>Увійдіть, щоб побачити рейтинг групи.</p>";
}
function switchView(name) {
  document.body.classList.toggle("cards-open", name === "cards");
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
  trackPresence();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function mergeCards(raw) {
  const grouped = new Map();
  raw
    .split(/\r?\n§§§\r?\n/)
    .filter(Boolean)
    .forEach((part) => {
      const split = part.indexOf("\t");
      if (split < 0) return;
      const uk = part.slice(0, split).trim(),
        de = part.slice(split + 1).trim(),
        m = uk.match(/Стаття\s+(\d+)/i);
      if (!m) return;
      const n = +m[1],
        u = uk.replace(/^Стаття\s+\d+\.\s*/i, ""),
        g = de.replace(/^Artikel\s+\d+\.\s*/i, "");
      if (!grouped.has(n))
        grouped.set(n, { n, uk: `Стаття ${n}.`, de: `Artikel ${n}.` });
      grouped.get(n).uk += `\n${u}`;
      grouped.get(n).de += `\n${g}`;
    });
  return ARTICLES.map((n) => grouped.get(n)).filter(Boolean);
}
async function loadCards() {
  try {
    cards = mergeCards(
      await fetch("cards.txt?v=9").then((r) => {
        if (!r.ok) throw Error();
        return r.text();
      }),
    );
    order = cards.map((_, i) => i);
    renderArticles();
    renderCard();
  } catch (e) {
    $("#cardUk").textContent =
      "Не вдалося завантажити картки. Оновіть сторінку.";
  }
}
function currentCard() {
  return cards[order[cardIndex]];
}
function renderCard() {
  if (!cards.length) return;
  cardIndex = Math.max(0, Math.min(cardIndex, order.length - 1));
  const c = currentCard();
  $("#cardUk").textContent = c.uk;
  $("#cardDe").textContent = c.de;
  $("#flashcard").classList.toggle("flipped", flipped);
  $("#cardCounter").textContent = `${cardIndex + 1} / ${order.length}${cardIndex === 0 ? " · початок" : cardIndex === order.length - 1 ? " · кінець" : ""}`;
  $("#prevCard").classList.toggle("state-on", !flipped);
  $("#nextCard").classList.toggle("state-on", flipped);
  $("#prevArticle").disabled = cardIndex === 0;
  $("#nextArticle").disabled = cardIndex === order.length - 1;
  $("#prevArticle").title =
    cardIndex === 0 ? "Це перша стаття" : "Попередня стаття";
  $("#nextArticle").title =
    cardIndex === order.length - 1 ? "Це остання стаття" : "Наступна стаття";
  $("#cardLearned").textContent = has("learned", c.n)
    ? "✓ Вивчено · скасувати"
    : "✓ Позначити вивчено";
  $("#cardReview").classList.toggle("state-on", has("review", c.n));
  $$(".difficulty-actions button").forEach((b) =>
    b.classList.toggle("state-on", state.difficulty[c.n] === b.dataset.level),
  );
  trackPresence();
}
function animateCard(step) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  $("#flashcard").animate(
    [
      {
        opacity: 0.35,
        transform: `translateX(${step > 0 ? "18px" : "-18px"})`,
      },
      { opacity: 1, transform: "translateX(0)" },
    ],
    { duration: 180, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
  );
}
function moveCard(step) {
  const next = Math.max(0, Math.min(cardIndex + step, order.length - 1));
  if (next === cardIndex) return;
  cardIndex = next;
  flipped = false;
  renderCard();
  animateCard(step);
}
function openArticle(n) {
  order = cards.map((_, i) => i);
  cardIndex = Math.max(
    0,
    cards.findIndex((c) => c.n === n),
  );
  flipped = false;
  switchView("cards");
  renderCard();
}
function startReview(all) {
  reviewQueue = (
    all ? ARTICLES.filter((n) => has("learned", n)) : dueArticles()
  ).filter((n) => cards.some((c) => c.n === n));
  reviewIndex = 0;
  reviewFlipped = false;
  $("#reviewEmpty").hidden = reviewQueue.length > 0;
  $("#reviewSession").hidden = !reviewQueue.length;
  if (reviewQueue.length) renderReviewCard();
}
function renderReviewCard() {
  const n = reviewQueue[reviewIndex],
    c = cards.find((x) => x.n === n);
  $("#reviewUk").textContent = c.uk;
  $("#reviewDe").textContent = c.de;
  $("#reviewCard").classList.toggle("flipped", reviewFlipped);
  $("#reviewCounter").textContent =
    `${reviewIndex + 1} / ${reviewQueue.length} · Стаття ${n}`;
}
function finishReview(known) {
  const n = reviewQueue[reviewIndex];
  if (known) {
    toggle("review", n, false);
    const level = (state.reviewLevel[n] || 0) + 1;
    state.reviewLevel[n] = level;
    state.nextReview[n] = Date.now() + [1, 3, 7, 14][Math.min(level, 3)] * DAY;
  } else {
    toggle("review", n, true);
    state.nextReview[n] = Date.now();
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
$("#leaderboardList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-profile]");
  if (!b) return;
  const p = groupProfiles.find((x) => x.user_id === b.dataset.profile);
  if (!p) return;
  const rank = groupProfiles.indexOf(p) + 1;
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
  flipped = !flipped;
  renderCard();
});
$("#prevCard").addEventListener("click", () => {
  flipped = false;
  renderCard();
});
$("#nextCard").addEventListener("click", () => {
  flipped = true;
  renderCard();
});
$("#prevArticle").addEventListener("click", () => moveCard(-1));
$("#nextArticle").addEventListener("click", () => moveCard(1));
$("#shuffleBtn").addEventListener("click", () => {
  order.sort(() => Math.random() - 0.5);
  cardIndex = 0;
  flipped = false;
  renderCard();
});
$("#cardLearned").addEventListener("click", () => learn(currentCard().n));
$("#cardReview").addEventListener("click", () => markReview(currentCard().n));
$$(".difficulty-actions button").forEach((b) =>
  b.addEventListener("click", () =>
    setDifficulty(currentCard().n, b.dataset.level),
  ),
);
$("#startToday").addEventListener("click", () => {
  const todo = todayPlan();
  order = todo
    .map((n) => cards.findIndex((c) => c.n === n))
    .filter((i) => i >= 0);
  if (!order.length) order = cards.map((_, i) => i);
  cardIndex = 0;
  flipped = false;
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
  reviewFlipped = !reviewFlipped;
  renderReviewCard();
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
    !$("#cardsView").classList.contains("active") ||
    ["INPUT", "TEXTAREA"].includes(e.target.tagName)
  )
    return;
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))
    e.preventDefault();
  if (e.key === "ArrowLeft") moveCard(-1);
  if (e.key === "ArrowRight") moveCard(1);
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    flipped = !flipped;
    renderCard();
  }
  if (e.code === "Space") {
    e.preventDefault();
    flipped = !flipped;
    renderCard();
  }
});
applyTheme(document.documentElement.dataset.theme || "light");
renderAll();
renderAuthStatus();
tick();
setInterval(tick, 1000);
loadCards();
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

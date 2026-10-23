const COURSE_STORAGE_KEY = 'shiguang-course-package';
const COURSE_LIBRARY_STORAGE_KEY = 'shiguang-course-library';
const ACTIVE_COURSE_KEY = 'shiguang-active-course';
const PLAN_STORAGE_KEY = 'shiguang-study-plans';
const LEGACY_PLAN_STORAGE_KEY = 'shiguang-study-plan';
const MATERIAL_NOTES_KEY = 'shiguang-material-notes';
const MATERIAL_BOOKMARKS_KEY = 'shiguang-material-bookmarks';
const fileInput = document.getElementById('course-file');
const toast = document.getElementById('toast');
let activeCourse = null;
let courseLibrary = [];
let activeChapterId = null;
let todayChapterId = null;
const fileViewerStore = new Map();
let fileViewerCounter = 0;
let activeFileObjectUrl = null;
const materialPageState = new Map();
let materialViewerCounter = 0;

function readJsonStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value && typeof value === 'object' ? value : fallback;
  } catch {
    return fallback;
  }
}

function materialPageKey(courseKey, materialId, pageNumber) {
  return `${courseKey}::${materialId || 'material'}::${pageNumber}`;
}

function getMaterialNotes(courseKey) {
  return readJsonStorage(MATERIAL_NOTES_KEY, {})[courseKey] || {};
}

function getMaterialBookmarks(courseKey) {
  return readJsonStorage(MATERIAL_BOOKMARKS_KEY, {})[courseKey] || {};
}

function isMaterialBookmarked(record) {
  const page = record.pages[record.index];
  return Boolean(page && getMaterialBookmarks(record.courseKey)[materialPageKey(record.courseKey, record.materialId, page.number || record.index + 1)]);
}

function saveMaterialNote(record, value) {
  const all = readJsonStorage(MATERIAL_NOTES_KEY, {});
  const notes = all[record.courseKey] || {};
  const page = record.pages[record.index];
  if (!page) return;
  const key = materialPageKey(record.courseKey, record.materialId, page.number || record.index + 1);
  if (value.trim()) notes[key] = value;
  else delete notes[key];
  all[record.courseKey] = notes;
  localStorage.setItem(MATERIAL_NOTES_KEY, JSON.stringify(all));
}

function toggleMaterialBookmark(record) {
  const all = readJsonStorage(MATERIAL_BOOKMARKS_KEY, {});
  const bookmarks = all[record.courseKey] || {};
  const page = record.pages[record.index];
  if (!page) return false;
  const key = materialPageKey(record.courseKey, record.materialId, page.number || record.index + 1);
  if (bookmarks[key]) delete bookmarks[key];
  else bookmarks[key] = { page: page.number || record.index + 1, materialId: record.materialId, materialName: record.fileName };
  all[record.courseKey] = bookmarks;
  localStorage.setItem(MATERIAL_BOOKMARKS_KEY, JSON.stringify(all));
  return Boolean(bookmarks[key]);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

function isCoursePackage(value) {
  return Boolean(value?.manifest && Array.isArray(value.chapters));
}

const COURSE_DB_NAME = 'shiguang-review-storage';
const COURSE_DB_VERSION = 1;

function openCourseDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(COURSE_DB_NAME, COURSE_DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore('courses');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });
}

function rememberCourse(course) {
  if (!isCoursePackage(course)) return;
  const key = getCourseKey(course);
  const index = courseLibrary.findIndex(item => getCourseKey(item) === key);
  if (index >= 0) courseLibrary[index] = course;
  else courseLibrary.push(course);
}

async function saveCoursePackage(course) {
  const key = getCourseKey(course);
  try {
    const db = await openCourseDb();
    await new Promise((resolve, reject) => {
      const store = db.transaction('courses', 'readwrite').objectStore('courses');
      const request = store.put(course, key);
      request.onsuccess = () => {
        if (key !== 'current') store.delete('current');
        resolve();
      };
      request.onerror = () => reject(request.error || new Error('IndexedDB write failed'));
    });
    db.close();
    localStorage.removeItem(COURSE_STORAGE_KEY);
    localStorage.removeItem(COURSE_LIBRARY_STORAGE_KEY);
  } catch (error) {
    try {
      const library = JSON.parse(localStorage.getItem(COURSE_LIBRARY_STORAGE_KEY) || '{}') || {};
      library[key] = course;
      localStorage.setItem(COURSE_LIBRARY_STORAGE_KEY, JSON.stringify(library));
      localStorage.removeItem(COURSE_STORAGE_KEY);
    } catch {
      throw new Error('课程包体积较大，当前浏览器无法保存，请清理站点空间后重试');
    }
  }
  rememberCourse(course);
  localStorage.setItem(ACTIVE_COURSE_KEY, key);
}

async function loadSavedCourses() {
  let courses = [];
  try {
    const db = await openCourseDb();
    courses = await new Promise((resolve, reject) => {
      const request = db.transaction('courses', 'readonly').objectStore('courses').getAll();
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('IndexedDB read failed'));
    });
    db.close();
  } catch {
    // Fall back to the older localStorage storage below.
  }
  if (!Array.isArray(courses) || !courses.length) {
    try {
      const library = JSON.parse(localStorage.getItem(COURSE_LIBRARY_STORAGE_KEY) || '{}') || {};
      courses = Object.values(library);
    } catch {
      courses = [];
    }
  }
  if (!courses.length) {
    try {
      const legacy = localStorage.getItem(COURSE_STORAGE_KEY);
      if (legacy) courses = [JSON.parse(legacy)];
    } catch {
      localStorage.removeItem(COURSE_STORAGE_KEY);
    }
  }
  const unique = [];
  const seen = new Set();
  courses.filter(isCoursePackage).forEach(course => {
    const key = getCourseKey(course);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(course);
    }
  });
  courseLibrary = unique;
  let activeKey = localStorage.getItem(ACTIVE_COURSE_KEY);
  if (!activeKey && unique.length) {
    try {
      await saveCoursePackage(unique[0]);
      activeKey = getCourseKey(unique[0]);
    } catch {
      activeKey = getCourseKey(unique[0]);
    }
  }
  return unique.find(course => getCourseKey(course) === activeKey) || unique[0] || null;
}

function getCourseKey(course) {
  return course.manifest?.id || course.manifest?.title || 'course';
}

function getToday() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function dateDifference(from, to) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  return Math.round((end - start) / 86400000);
}

function shiftDate(dateValue, offset) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function formatDate(date) {
  const [year, month, day] = date.split('-');
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function getPlan(course) {
  const key = getCourseKey(course);
  const plans = readPlanStore();
  const saved = plans[key];
  if (saved?.courseKey === getCourseKey(course)) {
    return { dailyChapters: Math.max(1, Number(saved.dailyChapters) || 1), startDate: saved.startDate || getToday(), mode: saved.mode === 'custom' ? 'custom' : 'fixed', schedule: saved.schedule && typeof saved.schedule === 'object' ? saved.schedule : {} };
  }
  return { courseKey: key, dailyChapters: 1, startDate: getToday(), mode: 'fixed', schedule: {} };
}

function readPlanStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAN_STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object' && saved.courseKey) return { [saved.courseKey]: saved };
    if (saved && typeof saved === 'object') return saved;
  } catch {
    localStorage.removeItem(PLAN_STORAGE_KEY);
  }
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_PLAN_STORAGE_KEY) || 'null');
    if (legacy?.courseKey) return { [legacy.courseKey]: legacy };
  } catch {
    localStorage.removeItem(LEGACY_PLAN_STORAGE_KEY);
  }
  return {};
}

function savePlan(course, plan) {
  const key = getCourseKey(course);
  const plans = readPlanStore();
  plans[key] = { ...plan, courseKey: key };
  localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plans));
  localStorage.removeItem(LEGACY_PLAN_STORAGE_KEY);
}

function getRecords(course) {
  const key = `shiguang-study-records:${getCourseKey(course)}`;
  try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { return {}; }
}

function saveRecords(course, records) {
  localStorage.setItem(`shiguang-study-records:${getCourseKey(course)}`, JSON.stringify(records));
}

function getPlannedChapters(course, date) {
  const plan = getPlan(course);
  if (plan.mode === 'custom') {
    const ids = Array.isArray(plan.schedule?.[date]) ? plan.schedule[date] : [];
    return ids.map(id => course.chapters.find((chapter, index) => chapterId(chapter, index) === id)).filter(Boolean);
  }
  const dayIndex = dateDifference(plan.startDate, date);
  if (dayIndex < 0) return [];
  const start = dayIndex * plan.dailyChapters;
  return course.chapters.slice(start, start + plan.dailyChapters);
}

function getTodayLearning(course) {
  if (!hasSavedPlan(course)) return { state: 'no-plan', planned: [], target: null };
  const planned = getPlannedChapters(course, getToday());
  if (!planned.length) {
    const plan = getPlan(course);
    return { state: getToday() < plan.startDate ? 'not-started' : 'empty', planned, target: null };
  }
  const records = getRecords(course);
  const completed = new Set(records[getToday()] || []);
  const target = planned.find((chapter, index) => !completed.has(chapterId(chapter, index))) || planned[0];
  const allDone = planned.every((chapter, index) => completed.has(chapterId(chapter, index)));
  return { state: allDone ? 'done' : 'ready', planned, target };
}

function hasSavedPlan(course) {
  return Boolean(readPlanStore()[getCourseKey(course)]);
}

function updateCourseSwitcher() {
  const wrap = document.getElementById('course-switcher-wrap');
  const select = document.getElementById('course-switcher');
  const count = document.getElementById('course-library-count');
  if (!wrap || !select) return;
  wrap.hidden = !courseLibrary.length;
  select.innerHTML = courseLibrary.map(course => {
    const key = getCourseKey(course);
    const title = course.manifest?.title || key;
    return `<option value="${escapeHtml(key)}">${escapeHtml(title)}</option>`;
  }).join('');
  if (activeCourse) select.value = getCourseKey(activeCourse);
  if (count) count.textContent = courseLibrary.length > 1 ? `已保存 ${courseLibrary.length} 个课程包，可随时切换` : '课程包会保存在当前浏览器';
}

function updateHomeCards() {
  const todayStatus = document.getElementById('today-feature-status');
  const importStatus = document.getElementById('import-feature-status');
  const planStatus = document.getElementById('plan-feature-status');
  const contentStatus = document.getElementById('content-feature-status');
  const reportStatus = document.getElementById('report-feature-status');
  if (!activeCourse) {
    todayStatus.textContent = '等待课程包';
    importStatus.textContent = '尚未导入';
    planStatus.textContent = '等待课程包';
    contentStatus.textContent = '等待课程包';
    reportStatus.textContent = '等待记录';
    return;
  }
  const plan = getPlan(activeCourse);
  const today = getTodayLearning(activeCourse);
  importStatus.textContent = `已导入 · ${activeCourse.chapters.length} 章`;
  if (today.state === 'no-plan') todayStatus.textContent = '先制定学习计划';
  else if (today.state === 'not-started') todayStatus.textContent = `计划从 ${formatDate(plan.startDate)} 开始`;
  else if (today.state === 'empty') todayStatus.textContent = '今天没有安排';
  else if (today.state === 'done') todayStatus.textContent = '今天已完成，可回顾';
  else todayStatus.textContent = `今天 · ${summarizeChapters(today.planned, activeCourse)}`;
  planStatus.textContent = hasSavedPlan(activeCourse) ? (plan.mode === 'custom' ? `自定义 · ${Object.keys(plan.schedule || {}).length} 天` : `每天 ${plan.dailyChapters} 章`) : '还没有制定计划';
  const contentCount = (activeCourse.flashcards || []).length + (activeCourse.quizzes || []).length;
  const materialCount = (activeCourse.materials || []).length + (activeCourse.teacherFiles || []).length;
  contentStatus.textContent = contentCount || materialCount ? `${contentCount + materialCount} 个学习内容` : '暂无整理内容';
  const report = getReportSummary(activeCourse, 7);
  reportStatus.textContent = report.completed ? `近 7 天完成 ${report.completed} 章` : '还没有学习记录';
}

function summarizeChapters(chapters, course) {
  const titles = chapters.map(chapter => chapterTitle(chapter, course.chapters.indexOf(chapter)));
  if (titles.length <= 2) return titles.join('、');
  return `${titles[0]}等 ${titles.length} 章`;
}

function getReportDates(course, days) {
  const today = getToday();
  return Array.from({ length: days }, (_, index) => shiftDate(today, -(days - index - 1)));
}

function getReportSummary(course, days = 7) {
  if (!course) return { planned: 0, completed: 0, activeDays: 0, rate: 0, streak: 0, dates: [] };
  const records = getRecords(course);
  const dates = getReportDates(course, days);
  if (!hasSavedPlan(course)) return { planned: 0, completed: 0, activeDays: 0, rate: 0, streak: 0, dates: dates.map(date => ({ date, planned: 0, completed: 0 })) };
  const rows = dates.map(date => {
    const plannedChapters = getPlannedChapters(course, date);
    const completedIds = new Set(records[date] || []);
    const completedChapters = plannedChapters.filter((chapter, index) => completedIds.has(chapterId(chapter, index)));
    return { date, planned: plannedChapters.length, completed: completedChapters.length };
  });
  let streak = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (!rows[index].completed) break;
    streak += 1;
  }
  const planned = rows.reduce((sum, row) => sum + row.planned, 0);
  const completed = rows.reduce((sum, row) => sum + row.completed, 0);
  return { planned, completed, activeDays: rows.filter(row => row.completed > 0).length, rate: planned ? Math.round(completed / planned * 100) : 0, streak, dates: rows };
}

function renderReport(days = 7) {
  if (!activeCourse) return;
  const summary = getReportSummary(activeCourse, days);
  document.getElementById('report-course-title').textContent = `${activeCourse.manifest?.title || '课程包'} · 学习报告`;
  document.getElementById('report-course-description').textContent = summary.planned ? `统计 ${formatDate(summary.dates[0].date)} 至 ${formatDate(summary.dates[summary.dates.length - 1].date)} 的计划与完成情况。` : '当前时间范围内还没有学习计划或完成记录。';
  document.getElementById('report-period-label').textContent = `近 ${days} 天`;
  document.getElementById('report-stats').innerHTML = [
    ['完成章节', `${summary.completed} / ${summary.planned}`],
    ['完成率', `${summary.rate}%`],
    ['学习天数', `${summary.activeDays} 天`],
    ['连续学习', `${summary.streak} 天`]
  ].map(([label, value]) => `<div class="report-stat"><strong>${value}</strong><span>${label}</span></div>`).join('');
  document.getElementById('report-bars').innerHTML = summary.dates.map(row => {
    const percent = row.planned ? Math.min(100, Math.round(row.completed / row.planned * 100)) : 0;
    return `<div class="report-bar-row"><span>${formatDate(row.date).slice(5)}</span><div class="report-bar-track"><i style="width:${percent}%"></i></div><b>${row.completed}/${row.planned}</b></div>`;
  }).join('');
  const insight = summary.completed === 0 ? '先在“今日学习”里完成一章，报告会从当天开始记录。' : summary.rate < 60 ? '当前完成率偏低，可以减少每天章节数，先保持连续学习。' : summary.streak >= 3 ? `已经连续学习 ${summary.streak} 天，继续保持这个节奏。` : '学习记录已经开始积累，保持每天完成计划即可。';
  document.getElementById('report-insight').innerHTML = `<strong>${summary.completed ? '继续保持' : '开始记录'}</strong><p>${insight}</p>`;
  document.querySelectorAll('[data-report-range]').forEach(button => {
    const active = Number(button.dataset.reportRange) === days;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
}

function showView(view) {
  const isHome = view === 'home';
  const isCourse = view === 'course';
  const isPlan = view === 'plan';
  const isToday = view === 'today';
  const isContent = view === 'content';
  const isReport = view === 'report';
  const homeIntro = document.getElementById('home-intro');
  if (homeIntro) homeIntro.hidden = !isHome;
  document.getElementById('home-features').hidden = !isHome;
  document.getElementById('course-panel').hidden = !isCourse || !activeCourse;
  document.getElementById('plan-panel').hidden = !isPlan || !activeCourse;
  document.getElementById('today-panel').hidden = !isToday || !activeCourse;
  document.getElementById('content-panel').hidden = !isContent || !activeCourse;
  document.getElementById('report-panel').hidden = !isReport || !activeCourse;
  document.getElementById('empty-state').hidden = !isCourse || Boolean(activeCourse);
  updateHomeCards();
  if (isReport) renderReport(Number(document.querySelector('[data-report-range].active')?.dataset.reportRange || 7));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function chapterId(chapter, index) {
  return chapter.id || `chapter-${index}`;
}

function chapterTitle(chapter, index) {
  return chapter.title || `第 ${index + 1} 章`;
}

function chapterNumber(chapter) {
  const idMatch = String(chapter?.id || '').match(/^ch(?:apter)?[-_ ]*0*(\d+)/i);
  if (idMatch) return Number(idMatch[1]);
  const titleMatch = String(chapter?.title || '').match(/第\s*(\d+|[一二三四五六七八九十百]+)\s*章/);
  if (!titleMatch) return null;
  if (/^\d+$/.test(titleMatch[1])) return Number(titleMatch[1]);
  const digits = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 百: 100 };
  const raw = titleMatch[1];
  if (raw.length === 1) return digits[raw] || null;
  if (raw === '十') return 10;
  if (raw.startsWith('十')) return 10 + (digits[raw[1]] || 0);
  if (raw.endsWith('十')) return (digits[raw[0]] || 0) * 10;
  if (raw.includes('十')) return (digits[raw[0]] || 0) * 10 + (digits[raw[2]] || 0);
  return null;
}

function isCaseChapter(chapter) {
  const id = String(chapter?.id || '');
  return /案例/.test(String(chapter?.title || '')) || /^ch(?:apter)?[-_ ]*\d+[-_]/i.test(id);
}

function normalizeFileEntry(entry) {
  if (typeof entry === 'string') {
    const name = entry.split(/[\\/]/).pop() || '课件文件';
    return { name, href: /^(https?:|data:|blob:|\/|\.)/.test(entry) ? entry : null };
  }
  if (!entry || typeof entry !== 'object') return null;
  const name = entry.name || entry.fileName || entry.title || entry.path || '课件文件';
  let href = entry.url || entry.href || entry.dataUrl || entry.path || null;
  if (!href && typeof entry.data === 'string') {
    href = entry.data.startsWith('data:') ? entry.data : `data:${entry.mimeType || 'application/octet-stream'};base64,${entry.data}`;
  }
  if (!href && typeof entry.content === 'string') href = `data:text/plain;charset=utf-8,${encodeURIComponent(entry.content)}`;
  return href ? { name, href, chapterId: entry.chapterId || null } : null;
}

function registerFileForViewer(file) {
  const id = `viewer-file-${fileViewerCounter += 1}`;
  fileViewerStore.set(id, file);
  return id;
}

function fileExtension(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function fileIsImage(file) {
  return /^data:image\//i.test(file.href || '') || /^image\//i.test(file.kind || '') || /^(png|jpe?g|gif|webp|svg)$/i.test(fileExtension(file.name));
}

function fileIsPdf(file) {
  return /^data:application\/pdf/i.test(file.href || '') || /^application\/pdf$/i.test(file.kind || '') || fileExtension(file.name) === 'pdf';
}

async function resolveViewerUrl(file) {
  if (!file?.href) throw new Error('课件地址无效');
  if (!file.href.startsWith('data:')) return file.href;
  const response = await fetch(file.href);
  const blob = await response.blob();
  activeFileObjectUrl = URL.createObjectURL(blob);
  return activeFileObjectUrl;
}

function closeFileModal() {
  const modal = document.getElementById('file-modal');
  if (!modal) return;
  modal.hidden = true;
  document.getElementById('file-modal-body').innerHTML = '';
  const download = document.getElementById('file-modal-download');
  download.removeAttribute('href');
  download.removeAttribute('download');
  if (activeFileObjectUrl) {
    URL.revokeObjectURL(activeFileObjectUrl);
    activeFileObjectUrl = null;
  }
}

async function openFileModal(fileId) {
  const file = fileViewerStore.get(fileId);
  const modal = document.getElementById('file-modal');
  if (!file || !modal) return;
  const body = document.getElementById('file-modal-body');
  const title = document.getElementById('file-modal-title');
  const download = document.getElementById('file-modal-download');
  closeFileModal();
  title.textContent = file.name || '课件文件';
  modal.hidden = false;
  body.innerHTML = '<p class="file-modal-loading">正在打开课件…</p>';
  try {
    const url = await resolveViewerUrl(file);
    download.href = url;
    download.download = file.name || '课件文件';
    if (fileIsImage(file)) {
      body.innerHTML = `<img class="file-modal-image" src="${escapeHtml(url)}" alt="${escapeHtml(file.name || '课件页面')}" />`;
    } else if (fileIsPdf(file)) {
      body.innerHTML = `<iframe class="file-modal-frame" src="${escapeHtml(url)}" title="${escapeHtml(file.name || 'PDF 课件')}" loading="lazy"></iframe>`;
    } else {
      body.innerHTML = '<div class="file-modal-message"><strong>这个文件不能在网页中直接预览</strong><p>请点击下方“下载文件”，再用 PowerPoint 或 WPS 打开 PPT/PPTX 课件。</p></div>';
    }
  } catch (error) {
    body.innerHTML = `<div class="file-modal-message"><strong>课件打开失败</strong><p>${escapeHtml(error.message || '请尝试下载后打开。')}</p></div>`;
  }
}

function normalizedName(value) {
  return String(value || '').toLowerCase().replace(/[\\/\s_-]+/g, '');
}

function inferChapterId(file, course) {
  const name = file.name || file.fileName || '';
  const normalized = normalizedName(name);
  const sourceMatch = (course.chapters || []).find(chapter => (chapter.sourceFiles || []).some(source => {
    const candidate = normalizedName(source);
    return candidate === normalized || normalized.includes(candidate) || candidate.includes(normalized);
  }));
  if (sourceMatch) return sourceMatch.id;
  if (/复习|提纲|考试/.test(name)) return course.chapters.find(chapter => chapter.id === 'review')?.id || null;
  const numberMatch = name.match(/(?:^|[^a-z0-9])ch(?:apter)?[-_ ]*0*(\d+)/i) || name.match(/第\s*0*(\d+)\s*章/);
  if (numberMatch) {
    const number = Number(numberMatch[1]);
    return course.chapters.find(chapter => chapter.id === `ch${number}` || chapter.title?.includes(`第${number}章`))?.id || null;
  }
  return null;
}

function assignTeacherFileChapters(course) {
  if (!Array.isArray(course.teacherFiles)) return false;
  let changed = false;
  course.teacherFiles = course.teacherFiles.map(file => {
    const chapterId = file.chapterId || inferChapterId(file, course);
    if (file.chapterId !== chapterId) changed = true;
    return { ...file, chapterId };
  });
  return changed;
}

function collectCourseFiles(course, chapter) {
  const scopedFiles = [...(Array.isArray(course.files) ? course.files : []), ...(Array.isArray(course.teacherFiles) ? course.teacherFiles : [])].filter(file => file.chapterId === chapter.id || (!file.chapterId && chapter.id === 'review'));
  const sources = [scopedFiles, course.assets, course.documents, course.resources, course.manifest?.files, course.manifest?.assets, chapter.files, chapter.assets, chapter.documents, chapter.resources];
  const files = [];
  sources.flatMap(value => Array.isArray(value) ? value : value ? [value] : []).forEach(entry => {
    const normalized = normalizeFileEntry(entry);
    if (normalized && !files.some(file => file.href === normalized.href)) files.push(normalized);
  });
  return files;
}

function imageSource(value) {
  if (!value) return '';
  if (/^(data:image\/|https?:|blob:)/.test(value)) return value;
  return `data:image/png;base64,${value}`;
}

function renderMaterialsSection(materials, files) {
  const pageTotal = materials.reduce((sum, material) => sum + (Array.isArray(material.pages) ? material.pages.length : Number(material.pageCount) || 0), 0);
  const materialMarkup = materials.map(material => {
    const pages = Array.isArray(material.pages) ? material.pages : [];
    const key = `material-viewer-${materialViewerCounter += 1}`;
    materialPageState.set(key, { pages, index: 0, zoom: 1, query: '', fileName: material.fileName || '课件', materialId: material.id || material.fileName || key, courseKey: getCourseKey(activeCourse) });
    return `<section class="material-carousel" data-material-carousel="${key}">
      <div class="material-carousel-head"><strong>${escapeHtml(material.fileName || '课件')}</strong><div class="material-carousel-tools"><span data-material-count>${pages.length ? 1 : 0} / ${pages.length || material.pageCount || 0} 页</span><label class="material-page-input"><input type="number" min="1" max="${pages.length || 1}" value="${pages.length ? 1 : 0}" aria-label="跳转到课件页" data-material-page-input="${key}" ${pages.length ? '' : 'disabled'} /><span>页</span></label><button class="material-quick-button" type="button" data-material-zoom-out="${key}" aria-label="缩小课件">−</button><button class="material-quick-button" type="button" data-material-zoom-reset="${key}">100%</button><button class="material-quick-button" type="button" data-material-zoom-in="${key}" aria-label="放大课件">＋</button><button class="material-quick-button" type="button" data-material-bookmark="${key}" aria-pressed="false">☆ 收藏本页</button></div></div>
      <div class="material-slide-wrap">
        <button class="material-carousel-button" type="button" data-material-prev="${key}" aria-label="上一页" ${pages.length <= 1 ? 'disabled' : ''}>‹</button>
        <div class="material-slide" data-material-slide="${key}">${renderMaterialSlideMarkup({ pages, index: 0, fileName: material.fileName || '课件' })}</div>
        <button class="material-carousel-button" type="button" data-material-next="${key}" aria-label="下一页" ${pages.length <= 1 ? 'disabled' : ''}>›</button>
      </div>
      <div class="material-tools-row"><label class="material-search"><span>页内搜索</span><input type="search" placeholder="搜索课件文字" aria-label="搜索课件文字" data-material-search-input="${key}" /><button class="material-quick-button" type="button" data-material-search-next="${key}">查找</button></label><label class="material-note"><span>本页笔记</span><textarea rows="2" placeholder="写下记忆线索或疑问" aria-label="本页笔记" data-material-note="${key}"></textarea></label></div>
    </section>`;
  }).join('');
  const fileMarkup = files.length ? `<div class="file-list">${files.map(file => `<button class="file-link" type="button" data-file-viewer="${registerFileForViewer(file)}"><span>↗</span>${escapeHtml(file.name)}</button>`).join('')}</div>` : '';
  return `<section class="lesson-section"><div class="lesson-section-title"><h3>课件查看</h3><span>${materials.length} 份 · ${pageTotal} 页</span></div>${fileMarkup}<div class="material-view-list">${materialMarkup}</div></section>`;
}

function renderMaterialSlideMarkup(record) {
  const page = record.pages[record.index];
  if (!page) return '<p class="material-slide-empty">这一份课件没有可用的页面预览。</p>';
  const image = imageSource(page.imageData);
  return image
    ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(page.alt || record.fileName || '课件页面')}" loading="lazy" style="transform:scale(${record.zoom || 1})" /><span class="material-slide-label">第 ${Number(page.number) || record.index + 1} 页</span>${page.text ? `<details class="material-text-details"><summary>查看可复制文字</summary><p>${escapeHtml(page.text)}</p></details>` : ''}`
    : '<p class="material-slide-empty">这一页没有可视化预览。</p>';
}

function refreshMaterialViewer(record) {
  const root = [...document.querySelectorAll('[data-material-carousel]')].find(element => element.dataset.materialCarousel === [...materialPageState.entries()].find(([, value]) => value === record)?.[0]);
  if (!root) return;
  root.querySelector('[data-material-slide]').innerHTML = renderMaterialSlideMarkup(record);
  root.querySelector('[data-material-count]').textContent = `${record.index + 1} / ${record.pages.length} 页`;
  root.querySelector('[data-material-page-input]').value = record.index + 1;
  root.querySelector('[data-material-prev]').disabled = record.index === 0;
  root.querySelector('[data-material-next]').disabled = record.index === record.pages.length - 1;
  const bookmark = root.querySelector('[data-material-bookmark]');
  const bookmarked = isMaterialBookmarked(record);
  bookmark.textContent = bookmarked ? '★ 已收藏' : '☆ 收藏本页';
  bookmark.setAttribute('aria-pressed', String(bookmarked));
  const note = getMaterialNotes(record.courseKey)[materialPageKey(record.courseKey, record.materialId, record.pages[record.index]?.number || record.index + 1)] || '';
  const noteInput = root.querySelector('[data-material-note]');
  if (noteInput) noteInput.value = note;
}

function changeMaterialPage(key, offset) {
  const record = materialPageState.get(key);
  if (!record || !record.pages.length) return;
  record.index = Math.max(0, Math.min(record.pages.length - 1, record.index + offset));
  const root = [...document.querySelectorAll('[data-material-carousel]')].find(element => element.dataset.materialCarousel === key);
  if (!root) return;
  refreshMaterialViewer(record);
}

function jumpMaterialPage(key, pageNumber) {
  const record = materialPageState.get(key);
  if (!record || !record.pages.length) return;
  const page = Number(pageNumber);
  if (!Number.isFinite(page)) return;
  record.index = Math.max(0, Math.min(record.pages.length - 1, Math.round(page) - 1));
  const root = [...document.querySelectorAll('[data-material-carousel]')].find(element => element.dataset.materialCarousel === key);
  if (!root) return;
  refreshMaterialViewer(record);
}

function renderContent(course) {
  const chapters = Array.isArray(course.chapters) ? course.chapters : [];
  if (!chapters.length) return;
  if (!activeChapterId || !chapters.some(chapter => chapter.id === activeChapterId)) activeChapterId = chapters[0].id || 'chapter-0';
  document.getElementById('content-course-title').textContent = course.manifest?.title || '课程内容';
  document.getElementById('content-course-description').textContent = course.manifest?.description ? `${course.manifest.description} 课件按“课件分章”设置显示。` : '查看每章整理的总结、知识点和课后题，课件按“课件分章”设置显示。';
  document.getElementById('content-chapter-total').textContent = `${chapters.length} 章`;
  document.getElementById('content-chapter-list').innerHTML = chapters.map((chapter, index) => {
    const id = chapter.id || `chapter-${index}`;
    const materialCount = (course.materials || []).filter(material => material.chapterId === id).length;
    return `<button class="content-chapter-button ${id === activeChapterId ? 'active' : ''}" data-content-chapter="${escapeHtml(id)}"><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(chapterTitle(chapter, index))}<small>${materialCount ? `${materialCount} 份课件` : '暂无课件'}</small></strong></button>`;
  }).join('');
  document.querySelectorAll('[data-content-chapter]').forEach(button => button.addEventListener('click', () => {
    activeChapterId = button.dataset.contentChapter;
    renderContent(course);
  }));
  renderLesson(course, chapters.find((chapter, index) => (chapter.id || `chapter-${index}`) === activeChapterId), chapters.indexOf(chapters.find((chapter, index) => (chapter.id || `chapter-${index}`) === activeChapterId)));
}

function renderToday(course) {
  if (!course) return;
  const today = getTodayLearning(course);
  const plan = getPlan(course);
  const title = document.getElementById('today-course-title');
  const description = document.getElementById('today-course-description');
  const status = document.getElementById('today-plan-status');
  const lesson = document.getElementById('today-lesson-card');
  if (today.state === 'no-plan') {
    title.textContent = '今天的学习内容';
    description.textContent = '还没有保存学习计划，请先制定每天学习几章。';
    status.textContent = '计划未保存';
    lesson.innerHTML = '<div class="content-empty">请先制定学习计划，系统会把今天应该学习的章节放在这里。</div>';
    return;
  }
  if (!today.target) {
    title.textContent = '今天没有安排章节';
    description.textContent = today.state === 'not-started' ? `计划从 ${formatDate(plan.startDate)} 开始。` : '当前计划已经完成，或者今天没有可学习的章节。';
    status.textContent = today.state === 'not-started' ? '计划未开始' : '今天已完成';
    lesson.innerHTML = '<div class="content-empty">今天暂时没有需要学习的章节，可以回顾学习内容或调整计划。</div>';
    return;
  }
  const plannedIds = new Set(today.planned.map((chapter, index) => chapterId(chapter, index)));
  if (!plannedIds.has(todayChapterId)) todayChapterId = chapterId(today.target, course.chapters.indexOf(today.target));
  const selectedChapter = today.planned.find((chapter, index) => chapterId(chapter, index) === todayChapterId) || today.target;
  const chapterIndex = course.chapters.indexOf(selectedChapter);
  title.textContent = chapterTitle(selectedChapter, chapterIndex);
  description.textContent = today.state === 'done' ? '今天安排的章节已经完成，可以随时回顾。' : `今天安排 · ${formatDate(getToday())}`;
  status.textContent = today.state === 'done' ? '今天已完成' : '今天进行中';
  renderLesson(course, selectedChapter, chapterIndex, 'today-lesson-card');
}

function selectTodayChapter(id) {
  if (!activeCourse) return;
  const today = getTodayLearning(activeCourse);
  if (!today.planned.some((chapter, index) => chapterId(chapter, index) === id)) return;
  todayChapterId = id;
  renderToday(activeCourse);
}

function renderMaterialAssignments(course) {
  const list = document.getElementById('material-assignment-list');
  if (!list) return;
  const materials = Array.isArray(course.materials) ? course.materials : [];
  const chapters = Array.isArray(course.chapters) ? course.chapters : [];
  if (!materials.length) {
    list.innerHTML = '<div class="material-assignment-empty">当前课程包没有可手动分章的课件预览。</div>';
    return;
  }
  list.innerHTML = materials.map((material, index) => `<div class="material-assignment-row"><div class="material-assignment-name">${escapeHtml(material.fileName || material.name || `课件 ${index + 1}`)}<span class="material-assignment-source">${Array.isArray(material.pages) ? material.pages.length : Number(material.pageCount) || 0} 页</span></div><select class="material-assignment-select" data-material-assignment="${index}"><option value="">未指定章节</option>${chapters.map((chapter, chapterIndex) => `<option value="${escapeHtml(chapter.id || `chapter-${chapterIndex}`)}" ${material.chapterId === (chapter.id || `chapter-${chapterIndex}`) ? 'selected' : ''}>${escapeHtml(chapterTitle(chapter, chapterIndex))}</option>`).join('')}</select></div>`).join('');
  list.querySelectorAll('[data-material-assignment]').forEach(select => select.addEventListener('change', () => assignMaterialChapter(Number(select.dataset.materialAssignment), select.value)));
}

async function assignMaterialChapter(materialIndex, chapterIdValue) {
  if (!activeCourse || !Array.isArray(activeCourse.materials) || !activeCourse.materials[materialIndex]) return;
  const material = activeCourse.materials[materialIndex];
  const previousChapterId = material.chapterId || null;
  const nextChapterId = chapterIdValue || null;
  material.chapterId = nextChapterId;
  syncChapterContentAfterMaterialMove(previousChapterId, nextChapterId, materialIndex);
  try {
    await saveCoursePackage(activeCourse);
    renderMaterialAssignments(activeCourse);
    renderContent(activeCourse);
    renderToday(activeCourse);
    showToast('课件所属章节已更新');
  } catch (error) {
    showToast(error.message || '课件分章保存失败');
  }
}

function syncChapterContentAfterMaterialMove(previousChapterId, nextChapterId, materialIndex) {
  if (!previousChapterId || !nextChapterId || previousChapterId === nextChapterId) return;
  const chapters = Array.isArray(activeCourse?.chapters) ? activeCourse.chapters : [];
  const source = chapters.find(chapter => chapter.id === previousChapterId);
  const target = chapters.find(chapter => chapter.id === nextChapterId);
  if (!source || !target) return;
  const sourceStillHasMaterials = (activeCourse.materials || []).some((material, index) => index !== materialIndex && material.chapterId === previousChapterId);
  if (sourceStillHasMaterials) return;

  const sourcePoints = Array.isArray(source.keyPoints) ? source.keyPoints : [];
  const targetPoints = Array.isArray(target.keyPoints) ? target.keyPoints : [];
  target.keyPoints = [...new Set([...targetPoints, ...sourcePoints])];
  source.keyPoints = [];

  (activeCourse.flashcards || []).forEach(card => {
    if (card.chapterId === previousChapterId) card.chapterId = nextChapterId;
  });
  (activeCourse.quizzes || []).forEach(quiz => {
    if (quiz.chapterId === previousChapterId) quiz.chapterId = nextChapterId;
  });

  if (Array.isArray(source.sourceFiles)) {
    target.sourceFiles = [...new Set([...(target.sourceFiles || []), ...source.sourceFiles])];
    source.sourceFiles = [];
  }
  if (Array.isArray(source.materialIds)) {
    target.materialIds = [...new Set([...(target.materialIds || []), ...source.materialIds])];
    source.materialIds = [];
  }
}

function renderLesson(course, chapter, chapterIndex, targetId = 'lesson-card') {
  if (!chapter) return;
  const keyPoints = Array.isArray(chapter.keyPoints) ? chapter.keyPoints : [];
  const flashcards = (course.flashcards || []).filter(card => card.chapterId === chapter.id);
  const quizzes = (course.quizzes || []).filter(quiz => quiz.chapterId === chapter.id);
  const materials = (course.materials || []).filter(material => material.chapterId === chapter.id);
  const files = collectCourseFiles(course, chapter);
  const sourceNames = Array.isArray(chapter.sourceFiles) ? chapter.sourceFiles : [];
  const sections = [];

  if (materials.length) {
    sections.push(renderMaterialsSection(materials, files));
  } else if (files.length) {
    sections.push(`<section class="lesson-section"><div class="lesson-section-title"><h3>课件文件</h3><span>点击打开</span></div><div class="file-list">${files.map(file => `<button class="file-link" type="button" data-file-viewer="${registerFileForViewer(file)}"><span>↗</span>${escapeHtml(file.name)}</button>`).join('')}</div></section>`);
  } else {
    sections.push(`<section class="attachment-note"><h3>课件查看</h3><p>当前课程包包含整理后的内容，但没有附带可打开的 PPT、PDF 或图片文件。</p><small>如果需要查看原始课件，请提供带完整文件的新课程包。</small>${sourceNames.length ? `<div class="source-names">已记录来源：${sourceNames.map(name => escapeHtml(name)).join('、')}</div>` : ''}</section>`);
  }
  if (keyPoints.length) {
    sections.push(`<section class="lesson-section"><div class="lesson-section-title"><h3>本章知识点</h3><span>${keyPoints.length} 个</span></div><ol class="key-point-list">${keyPoints.map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ol></section>`);
  }
  if (flashcards.length) {
    sections.push(`<section class="lesson-section"><div class="lesson-section-title"><h3>知识卡片</h3><span>${flashcards.length} 张</span></div><div class="learning-list">${flashcards.map(card => `<details class="learning-card"><summary>${escapeHtml(card.question || card.front || '知识卡片')}</summary><p>${escapeHtml(card.answer || card.back || '暂无答案')}</p>${card.hint ? `<small>提示：${escapeHtml(card.hint)}</small>` : ''}</details>`).join('')}</div></section>`);
  }
  if (quizzes.length) {
    sections.push(`<section class="lesson-section"><div class="lesson-section-title"><h3>课后题</h3><span>${quizzes.length} 题</span></div><div class="learning-list">${quizzes.map((quiz, index) => `<details class="learning-card quiz-card"><summary>${index + 1}. ${escapeHtml(quiz.question || '课后题')}</summary>${Array.isArray(quiz.options) ? `<ol class="quiz-options">${quiz.options.map(option => `<li>${escapeHtml(option)}</li>`).join('')}</ol>` : ''}<div class="answer-box"><strong>答案：${escapeHtml(quiz.answer || '暂无')}</strong>${quiz.explanation ? `<p>${escapeHtml(quiz.explanation)}</p>` : ''}</div></details>`).join('')}</div></section>`);
  }
  if (!keyPoints.length && !flashcards.length && !quizzes.length) sections.push('<div class="content-empty">本章节暂未提供知识点或课后题。</div>');
  document.getElementById(targetId).innerHTML = `<div class="lesson-header"><p class="eyebrow">第 ${chapterIndex + 1} 章</p><h2>${escapeHtml(chapterTitle(chapter, chapterIndex))}</h2><p>${escapeHtml(chapter.summary || '本章节暂无摘要。')}</p></div>${sections.join('')}`;
}

function mergeChapterInto(course, sourceId, targetId) {
  const sourceIndex = (course.chapters || []).findIndex(chapter => chapter.id === sourceId);
  const source = sourceIndex >= 0 ? course.chapters[sourceIndex] : null;
  const target = (course.chapters || []).find(chapter => chapter.id === targetId);
  if (!source || !target) return false;

  target.keyPoints = [...new Set([...(target.keyPoints || []), ...(source.keyPoints || [])])];
  if (source.summary && !String(target.summary || '').includes(source.summary)) target.summary = `${target.summary || ''} 案例补充：${source.summary}`.trim();
  target.sourceFiles = [...new Set([...(target.sourceFiles || []), ...(source.sourceFiles || [])])];
  if (Array.isArray(target.materialIds) || Array.isArray(source.materialIds)) {
    target.materialIds = [...new Set([...(target.materialIds || []), ...(source.materialIds || [])])];
  }
  (course.materials || []).forEach(material => { if (material.chapterId === sourceId) material.chapterId = targetId; });
  (course.flashcards || []).forEach(card => { if (card.chapterId === sourceId) card.chapterId = targetId; });
  (course.quizzes || []).forEach(quiz => { if (quiz.chapterId === sourceId) quiz.chapterId = targetId; });

  const plan = getPlan(course);
  if (plan.mode === 'custom') {
    const schedule = Object.fromEntries(Object.entries(plan.schedule || {}).map(([date, ids]) => [date, [...new Set((ids || []).map(id => id === sourceId ? targetId : id))]]));
    savePlan(course, { ...plan, schedule });
  }
  const records = getRecords(course);
  Object.keys(records).forEach(date => { records[date] = [...new Set((records[date] || []).map(id => id === sourceId ? targetId : id))]; });
  saveRecords(course, records);
  if (activeChapterId === sourceId) activeChapterId = targetId;
  if (todayChapterId === sourceId) todayChapterId = targetId;
  course.chapters.splice(sourceIndex, 1);
  return true;
}

function mergeKnownCaseChapters(course) {
  const candidates = [...(course.chapters || [])];
  let changed = false;
  candidates.forEach(source => {
    if (!isCaseChapter(source) || !(course.chapters || []).includes(source)) return;
    const number = chapterNumber(source);
    if (!number) return;
    const chapters = course.chapters || [];
    const primary = chapters.find(chapter => chapter !== source && chapter.id === `ch${number}`)
      || chapters.find(chapter => chapter !== source && chapterNumber(chapter) === number && !isCaseChapter(chapter));
    if (primary) changed = mergeChapterInto(course, source.id, primary.id) || changed;
  });
  return changed;
}

function renderCourse(course) {
  activeCourse = course;
  rememberCourse(course);
  localStorage.setItem(ACTIVE_COURSE_KEY, getCourseKey(course));
  activeChapterId = null;
  todayChapterId = null;
  updateCourseSwitcher();
  const merged = mergeKnownCaseChapters(course);
  const reassigned = assignTeacherFileChapters(course);
  if (merged || reassigned) saveCoursePackage(course).catch(() => {});
  const manifest = course.manifest || {};
  const chapters = Array.isArray(course.chapters) ? course.chapters : [];
  const flashcards = Array.isArray(course.flashcards) ? course.flashcards : [];
  const quizzes = Array.isArray(course.quizzes) ? course.quizzes : [];

  document.getElementById('course-title').textContent = manifest.title || '课程包';
  document.getElementById('course-description').textContent = manifest.description || '这套课程包已经准备好，可以开始查看章节内容。';
  document.getElementById('chapter-count').textContent = chapters.length;
  document.getElementById('material-count').textContent = (Array.isArray(course.materials) ? course.materials.length : 0) + (Array.isArray(course.teacherFiles) ? course.teacherFiles.length : 0);
  document.getElementById('card-count').textContent = flashcards.length;
  document.getElementById('quiz-count').textContent = quizzes.length;
  document.getElementById('chapter-list').innerHTML = chapters.map((chapter, index) => {
    const title = chapterTitle(chapter, index);
    const summary = chapter.summary || '本章节的重点内容已整理在课程包中。';
    const keyPointCount = Array.isArray(chapter.keyPoints) ? chapter.keyPoints.length : 0;
    const sourceCount = Array.isArray(chapter.sourceFiles) ? chapter.sourceFiles.length : 0;
    return `<article class="chapter-item">
      <div class="chapter-top"><span class="chapter-number">${String(index + 1).padStart(2, '0')}</span><h4>${escapeHtml(title)}</h4></div>
      <p>${escapeHtml(summary)}</p>
      <div class="chapter-foot"><span>${keyPointCount} 个重点</span><span>${sourceCount} 份资料</span></div>
    </article>`;
  }).join('');
  renderMaterialAssignments(course);
  updateHomeCards();
  renderPlanner();
  renderContent(course);
}

function renderPlanner() {
  if (!activeCourse) return;
  const plan = getPlan(activeCourse);
  const saved = hasSavedPlan(activeCourse);
  const planStart = document.getElementById('plan-start');
  const recordDate = document.getElementById('record-date');
  document.getElementById('daily-chapters').value = plan.dailyChapters;
  planStart.value = plan.startDate;
  planStart.removeAttribute('max');
  recordDate.max = getToday();
  if (!recordDate.value) recordDate.value = getToday();
  document.getElementById('plan-status').textContent = !saved ? '计划未保存' : plan.mode === 'custom' ? `自定义计划 · 已安排 ${Object.keys(plan.schedule || {}).length} 天` : `从 ${formatDate(plan.startDate)} 开始 · 每天 ${plan.dailyChapters} 章`;
  document.getElementById('plan-hint').textContent = !saved ? '保存固定计划或切换到自定义计划后开始学习。' : plan.mode === 'custom' ? '每天可以安排不同章节和数量。' : `按课程顺序安排，预计 ${Math.ceil(activeCourse.chapters.length / plan.dailyChapters)} 天完成。`;
  document.getElementById('plan-form').hidden = plan.mode === 'custom';
  document.getElementById('custom-plan-card').hidden = plan.mode !== 'custom';
  document.querySelectorAll('[data-plan-mode]').forEach(button => {
    const active = button.dataset.planMode === plan.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const customDate = document.getElementById('custom-plan-date');
  customDate.max = '';
  if (!customDate.value) customDate.value = getToday();
  renderCustomPlanBuilder();
  renderDailyRecord();
  renderHistory();
  renderToday(activeCourse);
}

function renderCustomPlanBuilder() {
  if (!activeCourse) return;
  const date = document.getElementById('custom-plan-date').value || getToday();
  const plan = getPlan(activeCourse);
  const selected = new Set(Array.isArray(plan.schedule?.[date]) ? plan.schedule[date] : []);
  const list = document.getElementById('custom-plan-chapters');
  list.innerHTML = activeCourse.chapters.map((chapter, index) => {
    const id = chapterId(chapter, index);
    return `<label class="custom-plan-chapter"><input type="checkbox" value="${escapeHtml(id)}" ${selected.has(id) ? 'checked' : ''} /><span>${escapeHtml(chapterTitle(chapter, index))}</span></label>`;
  }).join('');
  document.getElementById('custom-plan-summary').textContent = selected.size ? `${formatDate(date)} 已安排 ${selected.size} 章。` : `${formatDate(date)} 还没有安排章节。`;
  list.querySelectorAll('input').forEach(input => input.addEventListener('change', () => {
    const count = list.querySelectorAll('input:checked').length;
    document.getElementById('custom-plan-summary').textContent = count ? `${formatDate(date)} 已安排 ${count} 章。` : `${formatDate(date)} 还没有安排章节。`;
  }));
}

function switchPlanMode(mode) {
  if (!activeCourse) return;
  const plan = getPlan(activeCourse);
  plan.mode = mode;
  savePlan(activeCourse, plan);
  renderPlanner();
  updateHomeCards();
}

function saveCustomPlanForDate() {
  if (!activeCourse) return;
  const date = document.getElementById('custom-plan-date').value || getToday();
  const ids = [...document.querySelectorAll('#custom-plan-chapters input:checked')].map(input => input.value);
  const plan = getPlan(activeCourse);
  savePlan(activeCourse, { ...plan, mode: 'custom', schedule: { ...(plan.schedule || {}), [date]: ids } });
  document.getElementById('record-date').value = getToday();
  renderPlanner();
  updateHomeCards();
  showToast(`${formatDate(date)} 的学习安排已保存`);
}

function resetCurrentPlan() {
  if (!activeCourse) return;
  const title = activeCourse.manifest?.title || '当前课程包';
  if (!window.confirm(`确定重置「${title}」的学习计划吗？\n该课程包的计划和学习记录会被清除。`)) return;
  const key = getCourseKey(activeCourse);
  const plans = readPlanStore();
  delete plans[key];
  if (Object.keys(plans).length) localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plans));
  else localStorage.removeItem(PLAN_STORAGE_KEY);
  localStorage.removeItem(LEGACY_PLAN_STORAGE_KEY);
  localStorage.removeItem(`shiguang-study-records:${key}`);
  document.getElementById('record-date').value = getToday();
  renderPlanner();
  updateHomeCards();
  showToast('当前课程包的计划和学习记录已重置');
}

function renderDailyRecord() {
  if (!activeCourse) return;
  const date = document.getElementById('record-date').value || getToday();
  const plan = getPlan(activeCourse);
  const planned = getPlannedChapters(activeCourse, date);
  const records = getRecords(activeCourse);
  const completed = new Set(records[date] || []);
  const learned = planned.filter((chapter, index) => completed.has(chapterId(chapter, index)));
  const pending = planned.filter((chapter, index) => !completed.has(chapterId(chapter, index)));
  document.getElementById('day-planned').textContent = planned.length;
  document.getElementById('day-done').textContent = learned.length;
  document.getElementById('day-left').textContent = pending.length;

  const taskList = document.getElementById('task-list');
  if (!planned.length) {
    const message = date < plan.startDate ? `计划从 ${formatDate(plan.startDate)} 开始。` : '这一天没有安排章节，课程计划可能已经完成。';
    taskList.innerHTML = `<div class="no-task">${escapeHtml(message)}</div>`;
  } else {
    taskList.innerHTML = planned.map((chapter, index) => {
      const id = chapterId(chapter, index);
      const title = chapterTitle(chapter, index);
      return `<div class="task-item"><input type="checkbox" data-chapter-id="${escapeHtml(id)}" aria-label="标记${escapeHtml(title)}已完成" ${completed.has(id) ? 'checked' : ''} /><button class="task-chapter-link" type="button" data-today-chapter-id="${escapeHtml(id)}">${escapeHtml(title)}</button></div>`;
    }).join('');
    taskList.querySelectorAll('input').forEach(input => input.addEventListener('change', () => toggleChapter(date, input.dataset.chapterId, input.checked)));
    taskList.querySelectorAll('[data-today-chapter-id]').forEach(button => button.addEventListener('click', () => selectTodayChapter(button.dataset.todayChapterId)));
  }

  document.getElementById('daily-summary').innerHTML = `<div class="summary-box learned"><strong>今天学了</strong><span>${learned.length ? learned.map((chapter, index) => escapeHtml(chapterTitle(chapter, index))).join('、') : '还没有勾选完成的章节'}</span></div><div class="summary-box pending"><strong>还没学</strong><span>${pending.length ? pending.map((chapter, index) => escapeHtml(chapterTitle(chapter, index))).join('、') : '今天安排的章节都完成了'}</span></div>`;
}

function toggleChapter(date, id, checked) {
  if (!activeCourse) return;
  const records = getRecords(activeCourse);
  const current = new Set(records[date] || []);
  checked ? current.add(id) : current.delete(id);
  records[date] = [...current];
  saveRecords(activeCourse, records);
  renderDailyRecord();
  renderHistory();
  updateHomeCards();
  showToast(checked ? '已记录这一章学完' : '已取消这一章的完成记录');
}

function renderHistory() {
  if (!activeCourse) return;
  const records = getRecords(activeCourse);
  const plan = getPlan(activeCourse);
  const today = getToday();
  const dates = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const current = shiftDate(today, -offset);
    if (current >= plan.startDate) dates.push(current);
  }
  Object.keys(records).forEach(date => { if (!dates.includes(date)) dates.push(date); });
  dates.sort((a, b) => b.localeCompare(a));
  document.getElementById('history-list').innerHTML = dates.slice(0, 10).map(date => {
    const planned = getPlannedChapters(activeCourse, date);
    const done = planned.filter((chapter, index) => (records[date] || []).includes(chapterId(chapter, index))).length;
    const status = planned.length && done === planned.length ? '已完成' : done ? '进行中' : '未开始';
    const tone = planned.length && done === planned.length ? 'complete' : done ? 'progress' : 'idle';
    return `<button class="history-item ${tone}" data-history-date="${date}"><span>${formatDate(date)}</span><b>${done} / ${planned.length} 章</b><em>${status}</em></button>`;
  }).join('') || '<div class="no-history">保存计划后，这里会显示每天的学习记录。</div>';
  document.querySelectorAll('[data-history-date]').forEach(item => item.addEventListener('click', () => {
    document.getElementById('record-date').value = item.dataset.historyDate;
    renderDailyRecord();
  }));
}

function importCoursePackage(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.json')) {
    showToast('请选择 Codex 生成的 .course.json 文件');
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const course = JSON.parse(reader.result);
      if (!isCoursePackage(course)) throw new Error('invalid course package');
      await saveCoursePackage(course);
      renderCourse(course);
      showView('course');
      showToast(`已导入「${course.manifest.title || '课程包'}」`);
    } catch (error) {
      showToast(error.message || '课程包格式无法识别，请重新选择文件');
    } finally {
      fileInput.value = '';
    }
  };
  reader.readAsText(file, 'utf-8');
}

function switchActiveCourse(courseKey) {
  const course = courseLibrary.find(item => getCourseKey(item) === courseKey);
  if (!course || (activeCourse && getCourseKey(activeCourse) === courseKey)) return;
  renderCourse(course);
  showView('home');
  showToast(`已切换到「${course.manifest?.title || '课程包'}」`);
}

function openPicker() { fileInput.click(); }

document.addEventListener('click', event => {
  const fileButton = event.target.closest('[data-file-viewer]');
  if (fileButton) openFileModal(fileButton.dataset.fileViewer);
  const previousButton = event.target.closest('[data-material-prev]');
  if (previousButton) changeMaterialPage(previousButton.dataset.materialPrev, -1);
  const nextButton = event.target.closest('[data-material-next]');
  if (nextButton) changeMaterialPage(nextButton.dataset.materialNext, 1);
});
document.addEventListener('change', event => {
  const pageInput = event.target.closest('[data-material-page-input]');
  if (pageInput) jumpMaterialPage(pageInput.dataset.materialPageInput, pageInput.value);
  const note = event.target.closest('[data-material-note]');
  if (note) {
    const record = [...materialPageState.values()].find(value => value.courseKey && note.closest('[data-material-carousel]')?.dataset.materialCarousel && note.closest('[data-material-carousel]').dataset.materialCarousel === [...materialPageState.entries()].find(([, item]) => item === value)?.[0]);
    if (record) saveMaterialNote(record, note.value);
  }
});
document.addEventListener('input', event => {
  const note = event.target.closest('[data-material-note]');
  if (!note) return;
  const key = note.closest('[data-material-carousel]')?.dataset.materialCarousel;
  const record = materialPageState.get(key);
  if (record) saveMaterialNote(record, note.value);
});
document.addEventListener('click', event => {
  const zoomIn = event.target.closest('[data-material-zoom-in]');
  const zoomOut = event.target.closest('[data-material-zoom-out]');
  const zoomReset = event.target.closest('[data-material-zoom-reset]');
  const bookmark = event.target.closest('[data-material-bookmark]');
  const searchNext = event.target.closest('[data-material-search-next]');
  if (zoomIn || zoomOut || zoomReset || bookmark || searchNext) {
    const key = (zoomIn || zoomOut || zoomReset || bookmark || searchNext).dataset.materialZoomIn || (zoomIn || zoomOut || zoomReset || bookmark || searchNext).dataset.materialZoomOut || (zoomIn || zoomOut || zoomReset || bookmark || searchNext).dataset.materialZoomReset || (zoomIn || zoomOut || zoomReset || bookmark || searchNext).dataset.materialBookmark || (zoomIn || zoomOut || zoomReset || bookmark || searchNext).dataset.materialSearchNext;
    const record = materialPageState.get(key);
    if (!record) return;
    if (zoomIn) record.zoom = Math.min(2, Number((record.zoom + 0.1).toFixed(1)));
    if (zoomOut) record.zoom = Math.max(0.7, Number((record.zoom - 0.1).toFixed(1)));
    if (zoomReset) record.zoom = 1;
    if (bookmark) toggleMaterialBookmark(record);
    if (searchNext) {
      const input = document.querySelector(`[data-material-search-input="${CSS.escape(key)}"]`);
      const query = input?.value.trim().toLowerCase();
      record.query = query || '';
      if (query) {
        const start = record.index;
        for (let step = 1; step <= record.pages.length; step += 1) {
          const index = (start + step) % record.pages.length;
          if (String(record.pages[index]?.text || '').toLowerCase().includes(query) || String(record.pages[index]?.alt || '').toLowerCase().includes(query)) {
            record.index = index;
            break;
          }
        }
      }
    }
    refreshMaterialViewer(record);
  }
});
document.getElementById('file-modal-close').addEventListener('click', closeFileModal);
document.getElementById('file-modal-backdrop').addEventListener('click', closeFileModal);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeFileModal();
});

document.getElementById('brand-home').addEventListener('click', event => { event.preventDefault(); showView('home'); });
document.getElementById('empty-import').addEventListener('click', openPicker);
document.getElementById('empty-demo').addEventListener('click', async () => {
  const demo = { manifest: { id: 'demo-focus', title: '专注学习入门', description: '用一个 15 分钟的小课程，体验拾光复习的完整流程。' }, chapters: [
    { id: 'ch1', title: '为什么要主动回忆', summary: '主动回忆会让大脑从记忆中提取信息，比反复阅读更能巩固学习。', knowledgePoints: ['提取练习比重复阅读更有效', '先尝试回忆，再查看答案'], flashcards: [{ front: '主动回忆的核心动作是什么？', back: '在不看材料的情况下，主动从记忆中提取信息。' }], questions: [{ question: '哪种方式更有助于长期记忆？', answer: '合上材料后尝试回忆，再核对答案。' }] },
    { id: 'ch2', title: '把复习安排进日程', summary: '把大目标拆成每天可完成的小步骤，并在完成后留下记录。', knowledgePoints: ['小步完成比临时突击更稳定', '记录完成情况能帮助调整节奏'], flashcards: [{ front: '每天计划几章更容易坚持？', back: '从自己能稳定完成的数量开始，逐步调整。' }], questions: [{ question: '计划开始前最重要的动作是什么？', answer: '明确今天要完成的章节和时间。' }] }
  ], materials: [] };
  await saveCoursePackage(demo); activeCourse = demo; updateCourseSwitcher(); renderCourse(demo); showView('course'); showToast('示例课程已打开');
});
document.getElementById('replace-button').addEventListener('click', openPicker);
document.getElementById('feature-import').addEventListener('click', () => { showView('course'); openPicker(); });
document.getElementById('feature-today').addEventListener('click', () => {
  if (!activeCourse) {
    showToast('请先导入课程包');
    return;
  }
  const today = getTodayLearning(activeCourse);
  if (today.state === 'no-plan') {
    showView('plan');
    showToast('请先制定学习计划');
    return;
  }
  if (!today.target) {
    showView('plan');
    showToast(today.state === 'not-started' ? '学习计划还没有开始' : '今天没有安排章节');
    return;
  }
  renderToday(activeCourse);
  showView('today');
});
document.getElementById('feature-plan').addEventListener('click', () => {
  if (!activeCourse) {
    showToast('请先导入课程包');
    return;
  }
  showView('plan');
});
document.getElementById('feature-content').addEventListener('click', () => {
  if (!activeCourse) {
    showToast('请先导入课程包');
    return;
  }
  showView('content');
});
document.getElementById('feature-report').addEventListener('click', () => {
  if (!activeCourse) {
    showToast('请先导入课程包');
    return;
  }
  showView('report');
});
document.getElementById('course-home').addEventListener('click', () => showView('home'));
document.getElementById('today-home').addEventListener('click', () => showView('home'));
document.getElementById('plan-home').addEventListener('click', () => showView('home'));
document.getElementById('content-home').addEventListener('click', () => showView('home'));
document.getElementById('report-home').addEventListener('click', () => showView('home'));
fileInput.addEventListener('change', () => importCoursePackage(fileInput.files[0]));
document.getElementById('course-switcher').addEventListener('change', event => switchActiveCourse(event.target.value));
document.getElementById('record-date').addEventListener('change', renderDailyRecord);
document.getElementById('custom-plan-date').addEventListener('change', renderCustomPlanBuilder);
document.getElementById('save-custom-plan').addEventListener('click', saveCustomPlanForDate);
document.getElementById('reset-plan').addEventListener('click', resetCurrentPlan);
document.querySelectorAll('[data-plan-mode]').forEach(button => button.addEventListener('click', () => switchPlanMode(button.dataset.planMode)));
document.querySelectorAll('[data-report-range]').forEach(button => button.addEventListener('click', () => renderReport(Number(button.dataset.reportRange))));
document.getElementById('plan-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!activeCourse) return;
  const dailyChapters = Math.min(20, Math.max(1, Number(document.getElementById('daily-chapters').value) || 1));
  const startDate = document.getElementById('plan-start').value || getToday();
  const currentPlan = getPlan(activeCourse);
  savePlan(activeCourse, { ...currentPlan, dailyChapters, startDate, mode: 'fixed' });
  document.getElementById('record-date').value = getToday();
  renderPlanner();
  updateHomeCards();
  showToast('学习计划已保存');
});

showView('home');
loadSavedCourses().then(course => {
  if (isCoursePackage(course)) renderCourse(course);
  updateCourseSwitcher();
}).catch(() => {}).finally(() => showView('home'));


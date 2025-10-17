// ===== Logout (Navbar) =====
const logoutLink = document.getElementById('logoutLink');
if (logoutLink) {
  const username = (window.userInfo && window.userInfo.username) ? window.userInfo.username : '로그아웃';
  logoutLink.textContent = username; // 기본은 아이디 표시
  logoutLink.title = '로그아웃';

  // 텍스트 변경 함수 (크기 고정을 위해)
  const showLogout = () => {
    logoutLink.textContent = '로그아웃';
    logoutLink.style.minWidth = logoutLink.offsetWidth + 'px'; // 현재 크기 고정
  };
  const showUsername = () => {
    logoutLink.textContent = username;
    logoutLink.style.minWidth = logoutLink.offsetWidth + 'px'; // 현재 크기 고정
  };
  
  // 초기 크기 설정
  logoutLink.style.minWidth = Math.max(logoutLink.offsetWidth, 80) + 'px';
  
  logoutLink.addEventListener('mouseenter', showLogout);
  logoutLink.addEventListener('mouseleave', showUsername);
  logoutLink.addEventListener('focus', showLogout);
  logoutLink.addEventListener('blur', showUsername);

  logoutLink.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await fetch('/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      location.href = '/';
    }
  });
}

// ===== Navigation Animation =====
function animateNavigation(targetPage) {
  const buttons = {
    home: document.getElementById('homeBtn'),
    mylist: document.getElementById('mylistBtn'),
    ranking: document.getElementById('rankingBtn')
  };
  
  const slider = document.querySelector('.nav-slider');

  // 모든 버튼에서 active 클래스 제거
  Object.values(buttons).forEach(btn => {
    btn.classList.remove('active');
    btn.classList.add('inactive');
  });

  // 슬라이더 클래스 초기화
  slider.classList.remove('slide-home', 'slide-mylist', 'slide-ranking');

  // 현재 페이지 기준으로 슬라이더 위치와 활성 버튼 설정
  if (targetPage === 'home') {
    slider.classList.add('slide-home');
    buttons.home.classList.add('active');
    buttons.home.classList.remove('inactive');
  } else if (targetPage === 'mylist') {
    slider.classList.add('slide-mylist');
    buttons.mylist.classList.add('active');
    buttons.mylist.classList.remove('inactive');
  } else if (targetPage === 'ranking') {
    slider.classList.add('slide-ranking');
    buttons.ranking.classList.add('active');
    buttons.ranking.classList.remove('inactive');
  }

  // 페이지 이동 (애니메이션 후)
  setTimeout(() => {
    if (targetPage !== window.pageType) {
      location.href = `/${targetPage}`;
    }
  }, 300);
}

// 네비게이션 버튼 이벤트 리스너
document.getElementById('homeBtn')?.addEventListener('click', (e) => {
  e.preventDefault();
  animateNavigation('home');
});

document.getElementById('mylistBtn')?.addEventListener('click', (e) => {
  e.preventDefault();
  animateNavigation('mylist');
});

document.getElementById('rankingBtn')?.addEventListener('click', (e) => {
  e.preventDefault();
  animateNavigation('ranking');
});

// ===== Utilities =====
function sanitizeText(text) {
  if (!text) return '';
  return String(text)
    .replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))
    .trim();
}

function sanitizeInput(input) {
  if (!input) return '';
  return String(input).trim().slice(0, 1000);
}

// 분리된 날짜 필드에서 timestamp를 생성하는 함수
function getDatetimeFromFields(fieldPrefix) {
  const year = document.getElementById(fieldPrefix + '_year').value;
  const month = document.getElementById(fieldPrefix + '_month').value;
  const day = document.getElementById(fieldPrefix + '_day').value;
  const hour = document.getElementById(fieldPrefix + '_hour').value || '0';
  const minute = document.getElementById(fieldPrefix + '_minute').value || '0';
  
  if (!year || !month || !day) {
    return null; // 필수 필드가 비어있으면 null 반환
  }
  
  // Date 객체 생성 (month는 0부터 시작하므로 -1)
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
  return Math.floor(date.getTime() / 1000); // Unix timestamp로 반환
}

// timestamp를 분리된 날짜 필드에 설정하는 함수
function setDatetimeFields(fieldPrefix, timestamp) {
  if (!timestamp) {
    // 빈 값으로 설정
    document.getElementById(fieldPrefix + '_year').value = '';
    document.getElementById(fieldPrefix + '_month').value = '';
    document.getElementById(fieldPrefix + '_day').value = '';
    document.getElementById(fieldPrefix + '_hour').value = '';
    document.getElementById(fieldPrefix + '_minute').value = '';
    return;
  }
  
  const date = new Date(timestamp * 1000);
  document.getElementById(fieldPrefix + '_year').value = date.getFullYear();
  document.getElementById(fieldPrefix + '_month').value = date.getMonth() + 1;
  document.getElementById(fieldPrefix + '_day').value = date.getDate();
  document.getElementById(fieldPrefix + '_hour').value = date.getHours();
  document.getElementById(fieldPrefix + '_minute').value = date.getMinutes();
}

async function api(url, { method='GET', body, headers, timeout=10000, signal } = {}) {
  const controller = signal || new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', ...(headers||{}) } : headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('요청 시간이 초과되었습니다. 다시 시도해주세요.');
    }
    throw err;
  }
}

function showMessage(msg, type='info') {
  let el = document.getElementById('toastMsg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toastMsg';
    el.style.position = 'fixed';
    el.style.top = '72px';
    el.style.right = '16px';
    el.style.zIndex = '3000';
    document.body.appendChild(el);
  }
  el.innerHTML = `<div style="background:${type==='error'?'#f44336':type==='loading'?'#2196f3':'#4caf50'};color:#fff;padding:.8rem 1.2rem;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.2)">${sanitizeText(msg)}</div>`;
  if (type !== 'loading') {
    setTimeout(() => el.innerHTML = '', 3000);
  }
  return el;
}

function showLoading(msg = '처리 중...') {
  return showMessage(msg, 'loading');
}

function hideLoading() {
  const el = document.getElementById('toastMsg');
  if (el) el.innerHTML = '';
}

// ===== Data & DOM =====
let myCards = [];
let isLoadingCards = false;
let currentLoadRequest = null;
let editingCardId = null;

const container = document.getElementById('todoContainer');
const addModal = document.getElementById('addModal');
const editModal = document.getElementById('editModal');
const viewModal = document.getElementById('viewModal');

const newTodoTitle = document.getElementById('newTodoTitle');
const newTodoContent = document.getElementById('newTodoContent');
const newTodoVisibility = document.getElementById('newTodoVisibility');

const editTodoTitle = document.getElementById('editTodoTitle');
const editTodoDesc = document.getElementById('editTodoDesc');
const editContentList = document.getElementById('editContentList');

const viewTodoTitle = document.getElementById('viewTodoTitle');
const viewTodoDesc = document.getElementById('viewTodoDesc');
const viewContentList = document.getElementById('viewContentList');

const createNewTodo = document.getElementById('createNewTodo');
const cancelCreate = document.getElementById('cancelCreate');

// ===== Card HTML Generator =====
function cardHTML(card) {
  if (!card || !card.id) {
    console.error('Invalid card data:', card);
    return '';
  }
  const isCompleted = (card.contents || []).length > 0 && 
    (card.contents || []).every(c => c.completed);
  
  // 마감일 처리
  let deadlineHtml = '';
  if (card.deadline) {
    const deadlineDate = new Date(card.deadline * 1000);
    const now = new Date();
    const timeDiff = deadlineDate - now;
    
    // 년도 표시 여부 결정 (올해가 아니면 년도 표시)
    const currentYear = now.getFullYear();
    const deadlineYear = deadlineDate.getFullYear();
    const showYear = currentYear !== deadlineYear;
    
    let deadlineClass = 'deadline-normal';
    let deadlineText = deadlineDate.toLocaleDateString('ko-KR', {
      year: showYear ? 'numeric' : undefined,
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit'
    });
    
    if (timeDiff < 0) {
      deadlineClass = 'deadline-overdue';
      deadlineText = '⚠️ 기한 초과';
    } else if (timeDiff < 86400000) {
      deadlineClass = 'deadline-urgent';
      deadlineText = '🔥 ' + deadlineText;
    } else if (timeDiff < 259200000) {
      deadlineClass = 'deadline-warning';
      deadlineText = '⏰ ' + deadlineText;
    }
    
    deadlineHtml = `<div class="deadline ${deadlineClass}">${deadlineText}</div>`;
  }

  const completedClass = isCompleted ? ' completed' : '';
  const myClass = ' my';
  // 진행도 계산 및 0%일 때 숨김 처리
  const total = Math.max((card.contents || []).length, 1);
  const done = (card.contents || []).filter(c => c.completed).length;
  const percent = Math.round((done / total) * 100);
  const progressHtml = percent > 0
    ? `<div class="todo-progress">
        <div class="progress">
          <div class="progress-bar" data-target="${percent}" style="width:0%; min-width:0;">${percent}%</div>
        </div>
      </div>`
    : '';
  
  return `
    <div class="todo-card${completedClass}${myClass}" data-id="${card.id}">
      <div class="todo-id">${sanitizeText(card.username)}</div>
      <div class="todo-title">${sanitizeText(card.title)}</div>
      <div class="todo-desc">${sanitizeText(card.subtitle)}</div>
      <div class="badges">
        <span class="badge ${card.public ? 'bg-primary' : 'bg-secondary'}">${card.public ? '공개' : '비공개'}</span>
      </div>
      ${deadlineHtml}
      ${progressHtml}
      <div class="mt-2">
        <button class="btn btn-sm btn-primary" data-action="edit">수정</button>
        <button class="btn btn-sm btn-danger" data-action="delete">삭제</button>
      </div>
    </div>`;
}

// ===== Load Cards =====
async function loadCards() {
  // 이미 로딩 중이면 기존 요청을 취소하고 새 요청 시작
  if (isLoadingCards && currentLoadRequest) {
    currentLoadRequest.abort();
  }
  
  isLoadingCards = true;
  currentLoadRequest = new AbortController();
  
  const loadingEl = showLoading('카드를 불러오는 중...');
  try {
    myCards = await api('/api/cards?scope=my', { 
      signal: currentLoadRequest.signal,
      timeout: 5000 
    });
    renderCards();
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('이전 요청이 취소되었습니다.');
      return;
    }
    console.error('카드 로딩 오류:', err);
    showMessage(`카드 로딩 실패: ${err.message}`, 'error');
    myCards = [];
    renderCards();
  } finally {
    isLoadingCards = false;
    currentLoadRequest = null;
    hideLoading();
  }
}

function renderCards() {
  if (myCards.length === 0) {
    container.innerHTML = '<div class="text-center text-muted">아직 할일이 없습니다. 새로운 할일을 추가해보세요!</div>';
    updateTodoStats(0, 0);
    return;
  }
  container.innerHTML = myCards.map(cardHTML).join('');
  // 게이지 애니메이션: 채우기
  requestAnimationFrame(() => {
    document.querySelectorAll('#todoContainer .progress-bar[data-target]').forEach(el => {
      const target = parseInt(el.getAttribute('data-target') || '0', 10);
      void el.offsetWidth; // reflow
      el.style.width = target + '%';
      el.addEventListener('transitionend', () => {
        el.style.minWidth = '';
      }, { once: true });
    });
  });
  
  // Todo 통계 업데이트
  updateTodoStats();
}

// Todo 통계 업데이트 함수
function updateTodoStats(completedCount = null, totalCount = null) {
  const completedCountEl = document.getElementById('completedCount');
  const totalCountEl = document.getElementById('totalCount');
  
  if (completedCount !== null && totalCount !== null) {
    // 직접 값을 설정하는 경우 (빈 상태일 때)
    if (completedCountEl) completedCountEl.textContent = completedCount;
    if (totalCountEl) totalCountEl.textContent = totalCount;
    return;
  }
  
  // 카드 데이터에서 통계 계산
  let completed = 0;
  let total = myCards.length;
  
  myCards.forEach(card => {
    const contents = card.contents || [];
    if (contents.length > 0) {
      const isCompleted = contents.every(c => c.completed);
      if (isCompleted) {
        completed++;
      }
    }
  });
  
  if (completedCountEl) completedCountEl.textContent = completed;
  if (totalCountEl) totalCountEl.textContent = total;
}

// ===== Add Modal =====
document.getElementById('addBtn')?.addEventListener('click', () => {
  addModal.style.display = 'flex';
});

addModal?.addEventListener('click', e => {
  if (e.target === addModal) addModal.style.display = 'none';
});

// 새 카드 모달 닫기 버튼
document.getElementById('closeAdd')?.addEventListener('click', () => {
  document.getElementById('addTodoTitle').value = '';
  document.getElementById('addTodoDesc').value = '';
  document.getElementById('addTodoVisibility').value = 'public';
  setDatetimeFields('addTodoDeadline', null);
  addModal.style.display = 'none';
});

// 새 카드 저장 버튼
document.getElementById('saveAdd')?.addEventListener('click', async () => {
  const title = sanitizeInput(document.getElementById('addTodoTitle').value);
  const subtitle = sanitizeInput(document.getElementById('addTodoDesc').value);
  const deadline = getDatetimeFromFields('addTodoDeadline');
  const isPublic = (document.getElementById('addTodoVisibility').value === 'public');
  
  if (!title) return showMessage('제목을 입력하세요.', 'error');
  
  const loadingEl = showLoading('카드를 생성하는 중...');
  try {
    const body = { title, subtitle, contents: [], public: isPublic };
    if (deadline) body.deadline = deadline;
    await api('/api/cards', {
      method: 'POST',
      body
    });
    
    // 폼 초기화
    document.getElementById('addTodoTitle').value = '';
    document.getElementById('addTodoDesc').value = '';
    setDatetimeFields('addTodoDeadline', null);
    document.getElementById('addTodoVisibility').value = 'public';
    addModal.style.display = 'none';
    
    // 즉시 로컬 갱신
    await loadCards();
    
    // 다른 페이지들에게 브로드캐스트 (강제 갱신)
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('todo-updates');
      channel.postMessage({ type: 'cards-changed', scope: 'all' });
      channel.close();
    }
    
    showMessage('카드가 생성되었습니다.', 'success');
  } catch(err) {
    console.error('카드 생성 오류:', err);
    showMessage(`카드 생성 실패: ${err.message}`, 'error');
  } finally {
    hideLoading();
  }
});

// ===== Card Actions =====
container?.addEventListener('click', async (e) => {
  const cardEl = e.target.closest('.todo-card');
  if (!cardEl) return;
  
  const id = cardEl.dataset.id;
  const action = e.target.dataset.action;
  const card = myCards.find(c => c.id === id);
  if (!card) return;

  if (action === 'edit') {
    console.log('Opening edit modal for card:', card);
    openEdit(card);
  }
  if (action === 'delete') {
    if (!confirm('정말로 이 카드를 삭제하시겠습니까?')) return;
    try {
      await api(`/api/cards/${id}`, { method:'DELETE' });
      await loadCards();
      showMessage('카드를 삭제했습니다.', 'success');
    } catch(err) {
      showMessage(`카드 삭제 실패: ${err.message}`, 'error');
    }
  }
});

// ===== Edit Modal =====
function openEdit(card) {
  console.log('Opening edit modal with card:', card);
  if (!card || !card.id) {
    console.error('Invalid card data in openEdit:', card);
    showMessage('카드 정보를 불러올 수 없습니다.', 'error');
    return;
  }
  editingCardId = card.id;
  document.getElementById('editTodoTitle').value = card.title || '';
  document.getElementById('editTodoDesc').value = card.subtitle || '';
  
  // 마감일 설정 - 분리된 필드에 설정
  setDatetimeFields('editTodoDeadline', card.deadline);
  
  const editVisibilitySelect = document.getElementById('editTodoVisibility');
  if (editVisibilitySelect) {
    editVisibilitySelect.value = card.public ? 'public' : 'private';
  }
  
  document.getElementById('editContentList').innerHTML = '';
  (card.contents || []).forEach(item => {
    const li = document.createElement('li');
    li.innerHTML = `
      <input type="checkbox" class="contentCheck" ${item.completed ? 'checked' : ''}>
      <span data-completed="${item.completed ? 'true' : 'false'}">${sanitizeText(item.text || '')}</span>
      <div>
        <button class="editContentBtn inline-btn edit">수정</button>
        <button class="deleteContentBtn inline-btn delete">삭제</button>
      </div>`;
    document.getElementById('editContentList').appendChild(li);
  });
  editModal.style.display = 'flex';
}

editModal?.addEventListener('click', e => {
  if (e.target === editModal) editModal.style.display = 'none';
});

// 편집 모달 닫기 버튼
document.getElementById('closeEdit')?.addEventListener('click', () => {
  editModal.style.display = 'none';
  editingCardId = null;
});

// 편집 모달 삭제 버튼
document.getElementById('deleteEdit')?.addEventListener('click', async () => {
  if (!editingCardId || !confirm('정말로 이 카드를 삭제하시겠습니까?')) return;
  try {
    await api(`/api/cards/${editingCardId}`, { method: 'DELETE' });
    editModal.style.display = 'none';
    editingCardId = null;
    await loadCards();
    showMessage('카드를 삭제했습니다.', 'success');
  } catch(err) {
    showMessage(`카드 삭제 실패: ${err.message}`, 'error');
  }
});

// 편집 리스트 이벤트
document.getElementById('editContentList')?.addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  
  if (e.target.classList.contains('deleteContentBtn')) li.remove();
  if (e.target.classList.contains('editContentBtn')) {
    const span = li.querySelector('span');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = span.textContent;
    input.dataset.completed = span.dataset.completed || 'false';
    li.insertBefore(input, span);
    span.remove();
    e.target.textContent = '저장';
    e.target.classList.remove('editContentBtn');
    e.target.classList.add('saveContentBtn');
  } else if (e.target.classList.contains('saveContentBtn')) {
    const input = li.querySelector('input[type="text"]');
    const span = document.createElement('span');
    span.textContent = input.value;
    span.dataset.completed = input.dataset.completed || 'false';
    li.insertBefore(span, input);
    input.remove();
    e.target.textContent = '수정';
    e.target.classList.remove('saveContentBtn');
    e.target.classList.add('editContentBtn');
  }
});

document.getElementById('editContentList')?.addEventListener('change', (e) => {
  if (e.target.type === 'checkbox') {
    const span = e.target.nextElementSibling;
    if (span) {
      span.dataset.completed = e.target.checked ? 'true' : 'false';
    }
  }
});

// 새 컨텐츠 추가
document.getElementById('addEditContent')?.addEventListener('click', () => {
  const input = document.getElementById('editNewContent');
  const text = sanitizeInput(input.value);
  if (!text) return;
  
  const li = document.createElement('li');
  li.innerHTML = `
    <input type="checkbox" class="contentCheck">
    <span data-completed="false">${sanitizeText(text)}</span>
    <div>
      <button class="editContentBtn inline-btn edit">수정</button>
      <button class="deleteContentBtn inline-btn delete">삭제</button>
    </div>`;
  document.getElementById('editContentList').appendChild(li);
  input.value = '';
});

// 편집 모달 저장 버튼
document.getElementById('saveEdit')?.addEventListener('click', async () => {
  const title = sanitizeInput(document.getElementById('editTodoTitle').value);
  const subtitle = sanitizeInput(document.getElementById('editTodoDesc').value);
  const deadline = getDatetimeFromFields('editTodoDeadline');
  const isPublic = document.getElementById('editTodoVisibility').value === 'public';
  
  if (!title) return showMessage('제목을 입력하세요.', 'error');
  
  const contents = Array.from(document.getElementById('editContentList').children).map(li => {
    const checkbox = li.querySelector('input[type="checkbox"]');
    const span = li.querySelector('span');
    return {
      text: span ? span.textContent : '',
      completed: checkbox ? checkbox.checked : false
    };
  }).filter(c => c.text.trim());

  try {
    const body = { title, subtitle, contents, public: isPublic };
    if (deadline) body.deadline = deadline;
    else body.deadline = '';
    
    await api(`/api/cards/${editingCardId}`, {
      method: 'PUT',
      body
    });
    editModal.style.display = 'none';
    editingCardId = null;
    await loadCards();
    showMessage('카드가 수정되었습니다.', 'success');
  } catch(err) {
    showMessage(`카드 수정 실패: ${err.message}`, 'error');
  }
});

// ===== SSE =====
let sseSource;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

function startSSE() {
  if (sseSource && sseSource.readyState !== EventSource.CLOSED) return;
  
  try {
    sseSource = new EventSource('/api/cards/stream');
    
    sseSource.addEventListener('cards', (event) => {
      console.log('SSE cards event received:', event.data);
      loadCards();
    });
    
    sseSource.addEventListener('open', () => {
      console.log('SSE connection opened');
      reconnectAttempts = 0;
    });
    
    sseSource.addEventListener('error', (event) => {
      console.error('SSE error:', event);
      sseSource?.close();
      sseSource = null;
      
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        console.log(`SSE reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
        setTimeout(startSSE, delay);
      } else {
        console.error('SSE max reconnection attempts reached');
        showMessage('실시간 연결이 끊어졌습니다. 페이지를 새로고침하세요.', 'error');
      }
    });
  } catch (err) {
    console.error('SSE connection failed:', err);
  }
}

// BroadcastChannel을 통한 탭 간 통신 설정
if (typeof BroadcastChannel !== 'undefined') {
  const channel = new BroadcastChannel('todo-updates');
  channel.addEventListener('message', (event) => {
    if (event.data.type === 'cards-changed') {
      console.log('BroadcastChannel message received:', event.data);
      loadCards();
    }
  });
}

// 페이지 visibility 관리
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // 페이지가 숨겨질 때 SSE 연결 정리
    if (sseSource) {
      sseSource.close();
      sseSource = null;
    }
    // 진행 중인 요청 취소
    if (currentLoadRequest) {
      currentLoadRequest.abort();
      currentLoadRequest = null;
      isLoadingCards = false;
    }
  } else {
    // 페이지가 다시 보일 때 연결 재시작
    setTimeout(() => {
      if (!sseSource) {
        startSSE();
      }
      if (!isLoadingCards) {
        loadCards();
      }
    }, 100);
  }
});

// 페이지 종료 시 정리
window.addEventListener('beforeunload', () => {
  if (sseSource) {
    sseSource.close();
    sseSource = null;
  }
  if (currentLoadRequest) {
    currentLoadRequest.abort();
  }
});

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', () => {
  loadCards();
  startSSE();
});

// ===== Logout (Navbar) =====
const logoutLink = document.getElementById('logoutLink');
if (logoutLink) {
  const username = (window.userInfo && window.userInfo.username) ? window.userInfo.username : '로그아웃';
  // 기본은 아이디 표시
  logoutLink.textContent = username;
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

  // 클릭 시 로그아웃
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
let otherCards = [];
let isLoadingCards = false;
let currentLoadRequest = null;
const container = document.getElementById('todoContainer');
const viewModal = document.getElementById('viewModal');
const viewTodoTitle = document.getElementById('viewTodoTitle');
const viewTodoDesc = document.getElementById('viewTodoDesc');
const viewContentList = document.getElementById('viewContentList');

// ===== Card HTML Generator =====
function cardHTML(card) {
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
    
    // 24시간 = 86400000ms, 3일 = 259200000ms
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
    } else if (timeDiff < 86400000) { // 24시간 미만
      deadlineClass = 'deadline-urgent';
      deadlineText = '🔥 ' + deadlineText;
    } else if (timeDiff < 259200000) { // 3일 미만
      deadlineClass = 'deadline-warning';
      deadlineText = '⏰ ' + deadlineText;
    }
    
    deadlineHtml = `<div class="deadline ${deadlineClass}">${deadlineText}</div>`;
  }

  const completedClass = isCompleted ? ' completed' : '';
  const otherClass = ' others';
  
  // 완료 메달 표시
  let medalHtml = '';
  if (card.completionCount && card.completionCount > 0) {
    medalHtml = `<div class="completion-medal" title="${card.completionCount}개의 할일을 완료했습니다">🏅 ${card.completionCount}</div>`;
  }

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
    <div class="todo-card${completedClass}${otherClass}" data-id="${card.id}">
      <div class="todo-id">${sanitizeText(card.username)}</div>
      ${medalHtml}
      <div class="todo-title">${sanitizeText(card.title)}</div>
      <div class="todo-desc">${sanitizeText(card.subtitle)}</div>
      <div class="badges">
        <span class="badge ${card.public ? 'bg-primary' : 'bg-secondary'}">${card.public ? '공개' : '비공개'}</span>
      </div>
      ${deadlineHtml}
      ${progressHtml}
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
    otherCards = await api('/api/cards?scope=others', { 
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
    otherCards = [];
    renderCards();
  } finally {
    isLoadingCards = false;
    currentLoadRequest = null;
    hideLoading();
  }
}

function renderCards() {
  if (otherCards.length === 0) {
    container.innerHTML = '<div class="text-center text-muted">아직 공개된 할일이 없습니다.</div>';
    return;
  }
  container.innerHTML = otherCards.map(cardHTML).join('');

  // 게이지 애니메이션: 0 -> target 으로 부드럽게 채우기
  requestAnimationFrame(() => {
    document.querySelectorAll('#todoContainer .progress-bar[data-target]').forEach(el => {
      const target = parseInt(el.getAttribute('data-target') || '0', 10);
      // width는 0으로 이미 설정됨. minWidth 임시 해제 후 목표치로 이동
      void el.offsetWidth; // reflow
      el.style.width = target + '%';
      el.addEventListener('transitionend', () => {
        el.style.minWidth = '';
      }, { once: true });
    });
  });
}

// ===== Card Click Handler =====
container?.addEventListener('click', async (e) => {
  const cardEl = e.target.closest('.todo-card');
  if (!cardEl) return;
  
  const id = cardEl.dataset.id;
  const card = otherCards.find(c => c.id === id);
  if (!card) return;
  
  // 다른 사람의 카드 클릭 시 상세 보기 모달 열기
  openView(card);
});

// ===== View Modal =====
function openView(card) {
  viewTodoTitle.textContent = card.title || '제목 없음';
  viewTodoDesc.textContent = card.subtitle || '설명이 없습니다.';
  
  if (!card.contents || card.contents.length === 0) {
    viewContentList.innerHTML = '';
  } else {
    viewContentList.innerHTML = '';
    (card.contents || []).forEach(c => {
      const li = document.createElement('li');
      li.textContent = c.text || '';
      if (c.completed) {
        li.style.textDecoration = 'line-through';
        li.style.color = '#4caf50';
      }
      viewContentList.appendChild(li);
    });
  }
  
  viewModal.style.display = 'flex';
}

viewModal?.addEventListener('click', e => {
  if (e.target === viewModal) viewModal.style.display = 'none';
});

document.getElementById('closeView')?.addEventListener('click', () => {
  viewModal.style.display = 'none';
});

// ===== SSE (Server-Sent Events) =====
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

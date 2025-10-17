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

document.addEventListener('DOMContentLoaded', function() {
    // 네비게이션 버튼 이벤트 - 애니메이션 적용
    document.getElementById('homeBtn').addEventListener('click', (e) => {
        e.preventDefault();
        animateNavigation('home');
    });
    
    document.getElementById('mylistBtn').addEventListener('click', (e) => {
        e.preventDefault();
        animateNavigation('mylist');
    });
    
    document.getElementById('rankingBtn').addEventListener('click', (e) => {
        e.preventDefault();
        animateNavigation('ranking');
    });

    // 로그아웃: 아이디 기본 표시, 호버 시 '로그아웃'
    const logoutLink = document.getElementById('logoutLink');
    if (logoutLink) {
        const username = (window.userInfo && window.userInfo.username) ? window.userInfo.username : '로그아웃';
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
        logoutLink.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                await fetch('/logout', { method: 'POST', credentials: 'same-origin' });
            } finally {
                window.location.href = '/';
            }
        });
    }

    // 더보기 버튼 이벤트
    document.getElementById('showMoreBtn').addEventListener('click', () => {
        toggleExcelTable();
    });

    // 랭킹 데이터 로드 및 SSE 시작
    loadRanking();
    startSSE();
});

let currentRanking = []; // 전체 랭킹 데이터 저장
let isExcelTableVisible = false; // 엑셀 테이블 표시 상태

// ===== SSE (Server-Sent Events) =====
let sseSource;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
let isLoadingRanking = false;

function startSSE() {
    if (sseSource && sseSource.readyState !== EventSource.CLOSED) return;
    
    try {
        sseSource = new EventSource('/api/cards/stream');
        
        sseSource.addEventListener('cards', (event) => {
            console.log('SSE cards event received:', event.data);
            // 이미 로딩 중이 아닐 때만 새로 로드
            if (!isLoadingRanking) {
                loadRanking();
            }
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
                showError('실시간 연결이 끊어졌습니다. 페이지를 새로고침하세요.');
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
            if (!isLoadingRanking) {
                loadRanking();
            }
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
    } else {
        // 페이지가 다시 보일 때 연결 재시작
        setTimeout(() => {
            if (!sseSource) {
                startSSE();
            }
            if (!isLoadingRanking) {
                loadRanking();
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
});

async function loadRanking() {
    if (isLoadingRanking) return; // 이미 로딩 중이면 중복 요청 방지
    
    isLoadingRanking = true;
    
    try {
        const response = await fetch('/api/ranking');
        const ranking = await response.json();
        
        if (response.ok) {
            currentRanking = ranking;
            displayRanking(ranking);
        } else {
            showError('랭킹 데이터를 불러오는데 실패했습니다.');
        }
    } catch (error) {
        console.error('랭킹 로드 오류:', error);
        showError('서버 연결에 실패했습니다.');
    } finally {
        isLoadingRanking = false;
    }
}

function displayRanking(ranking) {
    const rankingList = document.getElementById('rankingList');
    const showMoreBtn = document.getElementById('showMoreBtn');
    
    if (!ranking || ranking.length === 0) {
        rankingList.innerHTML = `
            <div class="empty-ranking">
                <div style="font-size: 3rem; margin-bottom: 1rem;">📊</div>
                <div>아직 완료된 할일이 없습니다</div>
                <div style="font-size: 0.9rem; margin-top: 0.5rem; opacity: 0.7;">
                    할일을 완료하면 랭킹에 표시됩니다!
                </div>
            </div>
        `;
        showMoreBtn.classList.add('hidden');
        return;
    }

    // 상위 3위까지만 카드 형태로 표시
    const top3 = ranking.slice(0, 3);
    let html = '';
    
    top3.forEach((user, index) => {
        const rank = index + 1;
        const rankClass = `rank-${rank}`;
        
        html += `
            <div class="ranking-card ${rankClass}">
                <div class="ranking-position">${rank}</div>
                <div class="ranking-info">
                    <div class="ranking-username">${escapeHtml(user.username)}</div>
                    <div class="ranking-stats">
                        <div class="ranking-completed">
                            <span class="ranking-medal">🏅</span>
                            <div>
                                <div class="ranking-count">${user.completedCount}개</div>
                                <div class="ranking-label">완료</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="ranking-badges">
                    <div class="ranking-medal-badge">${getRankBadge(rank)}</div>
                </div>
            </div>
        `;
    });

    rankingList.innerHTML = html;
    
    // 4위 이하가 있으면 더보기 버튼 표시
    if (ranking.length > 3) {
        showMoreBtn.classList.remove('hidden');
        updateShowMoreButtonText();
    } else {
        showMoreBtn.classList.add('hidden');
    }
}

function toggleExcelTable() {
    const excelTableContainer = document.getElementById('excelTableContainer');
    const showMoreBtn = document.getElementById('showMoreBtn');
    
    if (isExcelTableVisible) {
        // 테이블 숨기기
        excelTableContainer.classList.add('hidden');
        isExcelTableVisible = false;
        updateShowMoreButtonText();
    } else {
        // 테이블 표시
        displayExcelTable();
        excelTableContainer.classList.remove('hidden');
        isExcelTableVisible = true;
        updateShowMoreButtonText();
        
        // 테이블로 부드럽게 스크롤
        setTimeout(() => {
            excelTableContainer.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'start' 
            });
        }, 100);
    }
}

function displayExcelTable() {
    const excelTableBody = document.getElementById('excelTableBody');
    
    // 4위부터의 데이터만 표시
    const remainingRanking = currentRanking.slice(3);
    
    let html = '';
    remainingRanking.forEach((user, index) => {
        const rank = index + 4; // 4위부터 시작
        
        html += `
            <tr>
                <td class="excel-rank">${rank}</td>
                <td class="excel-username">${escapeHtml(user.username)}</td>
                <td class="excel-completed">${user.completedCount}개</td>
            </tr>
        `;
    });
    
    if (html === '') {
        html = `
            <tr>
                <td colspan="3" style="text-align: center; padding: 2rem; color: #666; font-style: italic;">
                    4위 이하 데이터가 없습니다
                </td>
            </tr>
        `;
    }
    
    excelTableBody.innerHTML = html;
}

function updateShowMoreButtonText() {
    const showMoreBtn = document.getElementById('showMoreBtn');
    const remainingCount = currentRanking.length - 3;
    
    if (isExcelTableVisible) {
        showMoreBtn.innerHTML = '<span>접기 ▲</span>';
    } else {
        showMoreBtn.innerHTML = `<span>더보기 (4위 이하 ${remainingCount}명) ▼</span>`;
    }
}

function getRankBadge(rank) {
    const badges = {
        1: '🥇',
        2: '🥈', 
        3: '🥉'
    };
    return badges[rank] || '';
}

function showError(message) {
    const rankingList = document.getElementById('rankingList');
    const showMoreBtn = document.getElementById('showMoreBtn');
    const excelTableContainer = document.getElementById('excelTableContainer');
    
    rankingList.innerHTML = `
        <div class="empty-ranking" style="border-color: rgba(244,67,54,0.3); color: #f44336;">
            <div style="font-size: 3rem; margin-bottom: 1rem;">❌</div>
            <div>${message}</div>
            <div style="margin-top: 1rem;">
                <button onclick="retryLoadRanking()" style="
                    background: linear-gradient(135deg, #f44336, #d32f2f);
                    color: white;
                    border: none;
                    padding: 0.8rem 1.5rem;
                    border-radius: 20px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s ease;
                ">다시 시도</button>
            </div>
        </div>
    `;
    
    // 에러 시 더보기 버튼과 테이블 숨기기
    showMoreBtn.classList.add('hidden');
    excelTableContainer.classList.add('hidden');
    isExcelTableVisible = false;
}

function retryLoadRanking() {
    if (!isLoadingRanking) {
        loadRanking();
    }
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
}

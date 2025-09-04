from flask import Flask, render_template, jsonify, request, session, redirect, url_for, Response, stream_with_context
from pymongo import MongoClient, errors
from bson import ObjectId
import hashlib
import os
import json
import time
from datetime import datetime, timedelta
import queue
import threading
from threading import Lock
import secrets
import uuid

app = Flask(__name__)

# 보안 강화된 세션 설정
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))
app.config['SESSION_COOKIE_SECURE'] = os.environ.get('FLASK_ENV') == 'production'  # HTTPS에서만 작동 (프로덕션)
app.config['SESSION_COOKIE_HTTPONLY'] = True  # XSS 방지
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'  # CSRF 방지
app.config['SESSION_COOKIE_NAME'] = 'todolist_session'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)  # 30일간 유지

# 날짜 변환 헬퍼 함수
def datetime_local_to_timestamp(datetime_input):
    """datetime-local 형식의 문자열 또는 이미 변환된 timestamp를 처리"""
    if not datetime_input:
        return None
    
    # 이미 정수(timestamp)인 경우 그대로 반환
    if isinstance(datetime_input, (int, float)):
        return int(datetime_input)
    
    # 문자열인 경우 파싱
    if isinstance(datetime_input, str):
        try:
            # datetime-local은 로컬 시간이므로 그대로 파싱
            dt = datetime.strptime(datetime_input, '%Y-%m-%dT%H:%M')
            return int(dt.timestamp())
        except (ValueError, AttributeError):
            # Python 3.3 이전 버전에서는 timestamp() 메소드가 없음
            import calendar
            dt = datetime.strptime(datetime_input, '%Y-%m-%dT%H:%M')
            return int(calendar.timegm(dt.timetuple()))
    
    return None

# ---------------- Mongo connection ----------------
def connect_mongo():
    uris = []
    env_uri = os.getenv("MONGODB_URI")
    if env_uri:
        uris.append(env_uri)
    uris.append('mongodb://admin:admin1221@172.31.42.49:27017/')
    uris.append('mongodb://localhost:27017/')
    last_err = None
    for uri in uris:
        try:
            client = MongoClient(uri, serverSelectionTimeoutMS=5000)
            client.server_info()
            return client
        except Exception as e:
            last_err = e
            continue
    raise RuntimeError(f"MongoDB 연결 실패: {last_err}")

try:
    client = connect_mongo()
    db = client['todolist']
    users_collection = db['users']  
    cards_collection = db['cards']
    sessions_collection = db['sessions']  # 세션 저장용 컬렉션
    
    # username unique index
    try:
        users_collection.create_index('username', unique=True)
        # 세션 만료시간 인덱스 생성 (자동 삭제)
        sessions_collection.create_index('expires_at', expireAfterSeconds=0)
        # 세션 ID 인덱스
        sessions_collection.create_index('session_id', unique=True)
    except Exception:
        pass
    print("✅ MongoDB 연결 성공")
except Exception as e:
    print(f"❌ MongoDB 연결 실패: {e}")
    users_collection = None
    cards_collection = None
    sessions_collection = None

# ---------------- 강화된 세션 관리 ----------------
class EnhancedSessionManager:
    @staticmethod
    def create_session(user_id, username, remember_me=False):
        """새로운 세션 생성"""
        if sessions_collection is None:
            return None
            
        session_id = str(uuid.uuid4())
        session_data = {
            'user_id': user_id,
            'username': username,
            'login_time': datetime.utcnow(),
            'last_activity': datetime.utcnow(),
            'ip_address': request.remote_addr,
            'user_agent': request.headers.get('User-Agent', '')[:200]  # 길이 제한
        }
        
        # Remember me 기능에 따라 만료시간 설정
        expires_at = datetime.utcnow() + (timedelta(days=30) if remember_me else timedelta(hours=24))
        
        try:
            sessions_collection.insert_one({
                'session_id': session_id,
                'data': session_data,
                'created_at': datetime.utcnow(),
                'expires_at': expires_at,
                'active': True
            })
            return session_id
        except Exception as e:
            print(f"세션 생성 오류: {e}")
            return None
    
    @staticmethod
    def get_session(session_id):
        """세션 조회 및 활동시간 업데이트"""
        if sessions_collection is None or not session_id:
            return None
            
        try:
            session_doc = sessions_collection.find_one({
                'session_id': session_id,
                'active': True,
                'expires_at': {'$gt': datetime.utcnow()}
            })
            
            if session_doc:
                # 활동시간 업데이트
                sessions_collection.update_one(
                    {'session_id': session_id},
                    {'$set': {'data.last_activity': datetime.utcnow()}}
                )
                return session_doc['data']
            return None
        except Exception as e:
            print(f"세션 조회 오류: {e}")
            return None
    
    @staticmethod
    def update_session(session_id, update_data):
        """세션 데이터 업데이트"""
        if sessions_collection is None or not session_id:
            return False
            
        try:
            result = sessions_collection.update_one(
                {'session_id': session_id, 'active': True},
                {'$set': {f'data.{k}': v for k, v in update_data.items()}}
            )
            return result.modified_count > 0
        except Exception as e:
            print(f"세션 업데이트 오류: {e}")
            return False
    
    @staticmethod
    def delete_session(session_id):
        """세션 삭제 (로그아웃)"""
        if sessions_collection is None or not session_id:
            return False
            
        try:
            result = sessions_collection.update_one(
                {'session_id': session_id},
                {'$set': {'active': False, 'logout_time': datetime.utcnow()}}
            )
            return result.modified_count > 0
        except Exception as e:
            print(f"세션 삭제 오류: {e}")
            return False
    
    @staticmethod
    def delete_user_sessions(user_id, exclude_session=None):
        """특정 사용자의 모든 세션 삭제 (다른 기기에서 로그아웃)"""
        if sessions_collection is None:
            return False
            
        try:
            query = {'data.user_id': user_id, 'active': True}
            if exclude_session:
                query['session_id'] = {'$ne': exclude_session}
                
            result = sessions_collection.update_many(
                query,
                {'$set': {'active': False, 'logout_time': datetime.utcnow()}}
            )
            return result.modified_count
        except Exception as e:
            print(f"사용자 세션 삭제 오료: {e}")
            return 0

# 세션 관리자 인스턴스
session_manager = EnhancedSessionManager()

# ---------------- 세션 검증 미들웨어 ----------------
@app.before_request
def validate_session():
    """모든 요청 전에 세션 유효성 검증"""
    # 로그인 관련 페이지는 세션 검증 제외
    excluded_paths = ['/', '/login', '/register', '/check_username', '/static']
    if any(request.path.startswith(path) for path in excluded_paths):
        return
    
    session_id = session.get('session_id')
    if session_id:
        session_data = session_manager.get_session(session_id)
        if session_data:
            # 세션이 유효한 경우 Flask 세션 업데이트
            session['username'] = session_data['username']
            session['user_id'] = session_data['user_id']
        else:
            # 세션이 무효한 경우 세션 클리어
            session.clear()
            if request.path.startswith('/api/'):
                return jsonify({'error': 'Session expired'}), 401
            return redirect(url_for('Login'))
    else:
        # 세션이 없는 경우
        if request.path.startswith('/api/'):
            return jsonify({'error': 'Not logged in'}), 401
        return redirect(url_for('Login'))

# ---------------- Auth pages ----------------
@app.route('/', methods=['GET', 'POST'])
def Login():
    if 'username' in session:
        return redirect(url_for('home'))

    if request.method == 'POST':
        if users_collection is None:
            return jsonify({'result': 'fail', 'message': 'DB 연결 오류입니다.'})
        username = (request.form.get('username') or '').strip()
        password = request.form.get('password') or ''
        if not username or not password:
            return jsonify({'result': 'fail', 'message': '아이디와 비밀번호를 입력하세요.'})
        hashed = hashlib.sha256(password.encode()).hexdigest()
        user = users_collection.find_one({'username': username})
        if user and user.get('password') == hashed:
            # 강화된 세션 생성
            remember_me = request.form.get('remember_me') == 'true'
            session_id = session_manager.create_session(str(user['_id']), username, remember_me)
            
            if session_id:
                # Flask 세션에 세션 ID 저장
                session.permanent = True
                session['session_id'] = session_id
                session['username'] = username
                session['user_id'] = str(user['_id'])
                return jsonify({'result': 'success', 'message': '로그인 성공'})
            else:
                return jsonify({'result': 'fail', 'message': '세션 생성 실패'})
        return jsonify({'result': 'fail', 'message': '아이디 또는 비밀번호가 틀렸습니다.'})
    
    # GET 요청 시 템플릿 데이터 전달
    login_data = {
        'title': 'Todo List',
        'intro_features': [
            {'icon': '✔', 'text': '오늘의 목표 정하기'},
            {'icon': '✔', 'text': '중요한 일부터 시작하기'},
            {'icon': '✔', 'text': '완료하고 체크하기'}
        ],
        'form_fields': [
            {'type': 'text', 'id': 'username', 'name': 'username', 'placeholder': '아이디'},
            {'type': 'password', 'id': 'password', 'name': 'password', 'placeholder': '비밀번호'},
            {'type': 'checkbox', 'id': 'remember_me', 'name': 'remember_me', 'label': '로그인 상태 유지 (30일)'}
        ],
        'buttons': [
            {'type': 'submit', 'text': '로그인', 'class': 'btn btn-primary w-100 mb-2 py-2 fw-bold'},
            {'type': 'button', 'text': '회원가입', 'class': 'btn btn-secondary w-100 py-2 fw-bold', 'action': 'register'}
        ]
    }
    
    return render_template('login.html', login_data=login_data)

@app.route('/check_username', methods=['POST'])
def check_username():
    if users_collection is None:
        return jsonify({'result': 'fail', 'message': 'DB 연결 오류입니다.'})
    
    username = request.form.get('username', '').strip()
    
    if not username:
        return jsonify({'result': 'fail', 'message': '아이디를 입력하세요.'})
    
    if len(username) < 3 or len(username) > 20:
        return jsonify({'result': 'fail', 'message': '아이디는 3~20자여야 합니다.'})
    
    try:
        existing_user = users_collection.find_one({'username': username})
        if existing_user:
            return jsonify({'result': 'fail', 'message': '이미 존재하는 아이디입니다.'})
        else:
            return jsonify({'result': 'success', 'message': '사용 가능한 아이디입니다.'})
    except Exception as e:
        return jsonify({'result': 'fail', 'message': '서버 오류가 발생했습니다.'})

@app.route('/register', methods=['GET', 'POST'])
def Register():
    if request.method == 'POST':
        if users_collection is None:
            return jsonify({'result': 'fail', 'message': 'DB 연결 오류입니다.'})
        username = (request.form.get('reg-username') or '').strip()
        password = request.form.get('reg-password') or ''
        password_confirm = request.form.get('reg-password-confirm') or ''
        if not username or not password or not password_confirm:
            return jsonify({'result': 'fail', 'message': '모든 필드를 입력하세요.'})
        if len(username) < 3 or len(username) > 20:
            return jsonify({'result': 'fail', 'message': '아이디는 3~20자여야 합니다.'})
        if len(password) < 4:
            return jsonify({'result': 'fail', 'message': '비밀번호는 4자 이상이어야 합니다.'})
        if password != password_confirm:
            return jsonify({'result': 'fail', 'message': '비밀번호가 일치하지 않습니다.'})
        try:
            if users_collection.find_one({'username': username}):
                return jsonify({'result': 'fail', 'message': '이미 존재하는 아이디입니다.'})
            hashed = hashlib.sha256(password.encode()).hexdigest()
            users_collection.insert_one({'username': username, 'password': hashed})
            return jsonify({'result': 'success', 'message': '회원가입 성공'})
        except errors.DuplicateKeyError:
            return jsonify({'result': 'fail', 'message': '이미 존재하는 아이디입니다.'})
    
    # GET 요청 시 템플릿 데이터 전달
    register_data = {
        'title': 'Todo List',
        'subtitle': '회원가입',
        'form_sections': [
            {
                'type': 'username_section',
                'fields': [
                    {'type': 'text', 'id': 'reg-username', 'name': 'reg-username', 'placeholder': '아이디'},
                    {'type': 'button', 'id': 'checkUsername', 'text': '중복확인', 'class': 'btn btn-secondary'}
                ]
            },
            {
                'type': 'password_section',
                'fields': [
                    {'type': 'password', 'id': 'reg-password', 'name': 'reg-password', 'placeholder': '비밀번호'},
                    {'type': 'password', 'id': 'reg-password-confirm', 'name': 'reg-password-confirm', 'placeholder': '비밀번호 확인'}
                ]
            }
        ],
        'buttons': [
            {'type': 'submit', 'text': '회원가입', 'class': 'btn btn-primary w-100 mb-2 py-2 fw-bold'},
            {'type': 'button', 'text': '로그인으로 돌아가기', 'class': 'btn btn-secondary w-100 py-2 fw-bold', 'action': 'login'}
        ],
        'features': [
        ]
    }
    
    return render_template('register.html', register_data=register_data)

@app.route('/main')
def main():
    if 'username' not in session:
        return redirect(url_for('Login'))
    # 기본적으로 홈으로 리다이렉트
    return redirect(url_for('home'))

@app.route('/home')
def home():
    if 'username' not in session:
        return redirect(url_for('Login'))
    
    # 사용자 정보
    user_info = {
        'username': session['username'],
        'user_id': session.get('user_id')
    }
    
    # 홈 페이지용 모달들
    modals = {
        'view_modal': {
            'title': '상세 보기',
            'buttons': [
                {'id': 'closeView', 'text': '닫기', 'class': 'primary'}
            ]
        }
    }
    
    return render_template('home.html', 
                         user_info=user_info, 
                         modals=modals)

@app.route('/mylist')
def mylist():
    if 'username' not in session:
        return redirect(url_for('Login'))
    
    # 사용자 정보
    user_info = {
        'username': session['username'],
        'user_id': session.get('user_id')
    }
    
    # 내 리스트 페이지용 모달들
    modals = {
        'add_modal': {
            'title': '새 Todo 추가',
            'fields': [
                {'type': 'text', 'id': 'newTodoTitle', 'placeholder': '제목을 입력하세요'},
                {'type': 'textarea', 'id': 'newTodoContent', 'placeholder': '부제목/설명을 입력하세요', 'rows': 3},
                {'type': 'datetime-local', 'id': 'newTodoDeadline', 'label': '마감일 (선택사항)'},
                {'type': 'select', 'id': 'newTodoVisibility', 'label': '공개 여부', 'options': [
                    {'value': 'public', 'text': '공개'},
                    {'value': 'private', 'text': '비공개'}
                ]}
            ],
            'buttons': [
                {'id': 'cancelCreate', 'text': '취소', 'class': 'ghost'},
                {'id': 'createNewTodo', 'text': '생성', 'class': 'primary'}
            ]
        },
        'edit_modal': {
            'title': '세부 리스트',
            'fields': [
                {'type': 'text', 'id': 'editTodoTitle', 'placeholder': '제목 수정'},
                {'type': 'text', 'id': 'editTodoDesc', 'placeholder': '부제목/설명 수정'},
                {'type': 'datetime-local', 'id': 'editTodoDeadline', 'label': '마감일'},
                {'type': 'select', 'id': 'editTodoVisibility', 'label': '공개 여부', 'options': [
                    {'value': 'public', 'text': '공개'},
                    {'value': 'private', 'text': '비공개'}
                ]}
            ],
            'buttons': [
                {'id': 'cancelEdit', 'text': '닫기', 'class': 'ghost'},
                {'id': 'saveEditTodo', 'text': '저장', 'class': 'primary'}
            ]
        },
        'view_modal': {
            'title': '상세 보기',
            'buttons': [
                {'id': 'closeView', 'text': '닫기', 'class': 'primary'}
            ]
        }
    }
    
    return render_template('mylist.html', 
                         user_info=user_info, 
                         modals=modals)

@app.route('/ranking')
def ranking():
    if 'username' not in session:
        return redirect(url_for('Login'))
    
    # 사용자 정보
    user_info = {
        'username': session['username'],
        'user_id': session.get('user_id')
    }
    
    return render_template('ranking.html', user_info=user_info)

@app.route('/logout', methods=['POST'])
def logout():
    session_id = session.get('session_id')
    if session_id:
        session_manager.delete_session(session_id)
    session.clear()
    return jsonify({'result': 'success', 'message': '로그아웃 되었습니다.'})

@app.route('/logout-all', methods=['POST'])
def logout_all():
    """모든 기기에서 로그아웃"""
    user_id = session.get('user_id')
    session_id = session.get('session_id')
    
    if user_id:
        deleted_count = session_manager.delete_user_sessions(user_id, exclude_session=session_id)
        session.clear()
        return jsonify({
            'result': 'success', 
            'message': f'모든 기기에서 로그아웃되었습니다. ({deleted_count + 1}개 세션 종료)'
        })
    return jsonify({'result': 'fail', 'message': '로그인 상태가 아닙니다.'})

@app.route('/api/session-info')
def session_info():
    """현재 세션 정보 조회"""
    session_id = session.get('session_id')
    if not session_id:
        return jsonify({'error': 'No active session'}), 401
    
    session_data = session_manager.get_session(session_id)
    if not session_data:
        return jsonify({'error': 'Invalid session'}), 401
    
    return jsonify({
        'username': session_data.get('username'),
        'login_time': session_data.get('login_time'),
        'last_activity': session_data.get('last_activity'),
        'ip_address': session_data.get('ip_address')
    })

@app.route('/api/user-info')
def user_info():
    if 'username' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    return jsonify({'username': session['username'], 'user_id': session.get('user_id')})

@app.route('/api/ranking')
def get_ranking():
    if 'username' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    if cards_collection is None:
        return jsonify({'error': 'DB not available'}), 500
    
    try:
        # 사용자별 완료 통계 계산
        user_stats = get_user_completion_stats()
        
        # 완료 수 기준으로 내림차순 정렬
        ranking = []
        for username, completed_count in user_stats.items():
            ranking.append({
                'username': username,
                'completedCount': completed_count
            })
        
        # 완료 수가 높은 순으로 정렬
        ranking.sort(key=lambda x: x['completedCount'], reverse=True)
        
        return jsonify(ranking)
    except Exception as e:
        app.logger.error(f"Error getting ranking: {e}")
        return jsonify({'error': 'Failed to get ranking'}), 500

# ---------------- SSE ----------------
_subscribers = set()
_subs_lock = Lock()

def _event_stream():
    q = queue.Queue(maxsize=100)
    with _subs_lock:
        _subscribers.add(q)
    try:
        yield 'event: ping\ndata: keep-alive\n\n'
        while True:
            try:
                msg = q.get(timeout=25)
                yield f"event: cards\ndata: {msg}\n\n"
            except queue.Empty:
                yield 'event: ping\ndata: keep-alive\n\n'
    finally:
        with _subs_lock:
            _subscribers.discard(q)

def _broadcast_cards_changed(scope='any'):
    payload = json.dumps({'type':'cards-changed','scope':scope,'ts':int(time.time())})
    with _subs_lock:
        dead = []
        active_count = 0
        for q in list(_subscribers):
            try: 
                q.put_nowait(payload)
                active_count += 1
            except Exception as e:
                print(f"브로드캐스트 오류: {e}")
                dead.append(q)
        for q in dead:
            _subscribers.discard(q)
        print(f"브로드캐스트 완료: {active_count}개 클라이언트에게 전송, {len(dead)}개 연결 제거")

@app.route('/api/cards/stream')
def cards_stream():
    if 'user_id' not in session:
        return jsonify({'error':'Not logged in'}), 401
    headers = {'Cache-Control':'no-cache','X-Accel-Buffering':'no','Connection':'keep-alive'}
    return Response(stream_with_context(_event_stream()), mimetype='text/event-stream', headers=headers)

# ---------------- Cards API ----------------
def serialize_card(doc):
    return {
        'id': str(doc.get('_id')),
        'user_id': str(doc.get('user_id')) if isinstance(doc.get('user_id'), ObjectId) else (doc.get('user_id') or ''),
        'username': doc.get('username') or '',
        'title': doc.get('title') or '',
        'subtitle': doc.get('subtitle') or '',
        'contents': [{'text': (c.get('text') or ''), 'completed': bool(c.get('completed'))} for c in (doc.get('contents') or [])],
        'public': bool(doc.get('public', False)),
        'deadline': doc.get('deadline'),  # 마감일 추가
        'createdAt': int(doc.get('createdAt') or 0),
        'updatedAt': int(doc.get('updatedAt') or 0),
    }

def get_user_completion_stats():
    """사용자별 100% 완료된 공개 카드 수를 계산 (비공개 카드는 제외)"""
    if cards_collection is None:
        return {}
    
    try:
        # 공개 카드만 가져와서 완료율 계산
        all_cards = list(cards_collection.find({'public': True}))
        user_stats = {}
        
        for card in all_cards:
            username = card.get('username', '')
            if not username:
                continue
                
            contents = card.get('contents', [])
            if not contents:
                continue
                
            # 100% 완료된 카드인지 확인
            total_tasks = len(contents)
            completed_tasks = sum(1 for c in contents if c.get('completed', False))
            
            if total_tasks > 0 and completed_tasks == total_tasks:
                # 100% 완료된 공개 카드
                if username not in user_stats:
                    user_stats[username] = 0
                user_stats[username] += 1
        
        return user_stats
    except Exception as e:
        app.logger.error(f"Error calculating user stats: {e}")
        return {}

@app.route('/api/cards', methods=['GET','POST'])
def cards():
    if 'user_id' not in session:
        return jsonify({'error':'Not logged in'}), 401
    if cards_collection is None:
        return jsonify({'error':'DB not available'}), 500

    uid_str = session['user_id']
    try:
        uid = ObjectId(uid_str)
    except Exception:
        return jsonify({'error':'Invalid session user'}), 400

    if request.method == 'GET':
        scope = request.args.get('scope','my')
        if scope == 'my':
            query = {'user_id': uid}
        else:
            query = {'user_id': {'$ne': uid}, 'public': True}
        docs = cards_collection.find(query).sort('createdAt', -1)
        cards_data = [serialize_card(d) for d in docs]
        
        # 다른 사람의 카드를 보는 경우 (홈 페이지), 완료 통계 추가
        if scope == 'others':
            user_stats = get_user_completion_stats()
            for card in cards_data:
                username = card.get('username', '')
                card['completionCount'] = user_stats.get(username, 0)
        
        return jsonify(cards_data)

    # POST create
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    subtitle = (data.get('subtitle') or '').strip()
    contents = data.get('contents') or []
    deadline = data.get('deadline')  # 마감일 추가
    if not title:
        return jsonify({'error':'제목을 입력하세요.'}), 400
    if not isinstance(contents, list):
        return jsonify({'error':'contents 형식이 올바르지 않습니다.'}), 400
    try:
        doc = {
            'user_id': uid,
            'username': session.get('username'),
            'title': title,
            'subtitle': subtitle,
            'contents': [
                {'text': (c.get('text') or '').strip(), 'completed': bool(c.get('completed'))}
                for c in contents if isinstance(c, dict) and (c.get('text') or '').strip()
            ],
            'public': bool(data.get('public', False)),
            'deadline': datetime_local_to_timestamp(deadline),  # 마감일 저장
            'createdAt': int(time.time()),
            'updatedAt': int(time.time()),
        }
        res = cards_collection.insert_one(doc)
        doc['_id'] = res.inserted_id
    except Exception as e:
        app.logger.error(f"DB insert error: {e}")
        return jsonify({'error': f'DB insert error: {e}'}), 500
    
    # 강력한 브로드캐스트 수행
    try: 
        _broadcast_cards_changed('any')
        app.logger.info(f"Broadcast sent for new card: {res.inserted_id}")
        # 추가 브로드캐스트 (0.1초 후)
        threading.Timer(0.1, lambda: _broadcast_cards_changed('any')).start()
    except Exception as e:
        app.logger.error(f"Broadcast error: {e}")
    
    return jsonify({'success': True, 'id': str(res.inserted_id), 'card': serialize_card(doc)}), 201

@app.route('/api/cards/<card_id>', methods=['PUT','DELETE'])
def card_detail(card_id):
    if 'user_id' not in session:
        return jsonify({'error':'Not logged in'}), 401
    if cards_collection is None:
        return jsonify({'error':'DB not available'}), 500
    try:
        _id = ObjectId(card_id)
        uid = ObjectId(session['user_id'])
    except Exception:
        return jsonify({'error':'Invalid id'}), 400

    if request.method == 'DELETE':
        res = cards_collection.delete_one({'_id': _id, 'user_id': uid})
        if res.deleted_count == 0:
            return jsonify({'error':'삭제할 카드가 없거나 권한이 없습니다.'}), 404
        try: _broadcast_cards_changed('any')
        except Exception: pass
        return jsonify({'ok': True})

    # PUT
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    subtitle = (data.get('subtitle') or '').strip()
    contents = data.get('contents') or []
    deadline = data.get('deadline')  # 마감일 추가
    if not title:
        return jsonify({'error':'제목을 입력하세요.'}), 400
    if not isinstance(contents, list):
        return jsonify({'error':'contents 형식이 올바르지 않습니다.'}), 400
    try:
        update = {
            'title': title,
            'subtitle': subtitle,
            'contents': [
                {'text': (c.get('text') or '').strip(), 'completed': bool(c.get('completed'))}
                for c in contents if isinstance(c, dict) and (c.get('text') or '').strip()
            ],
            'updatedAt': int(time.time()),
        }
        if deadline:
            update['deadline'] = datetime_local_to_timestamp(deadline)
        elif deadline == '':  # 빈 문자열이면 마감일 제거
            update['deadline'] = None
        if 'public' in data:
            update['public'] = bool(data.get('public'))
        res = cards_collection.update_one({'_id': _id, 'user_id': uid}, {'$set': update})
        if res.matched_count == 0:
            return jsonify({'error':'수정할 카드가 없거나 권한이 없습니다.'}), 404
        doc = cards_collection.find_one({'_id': _id})
    except Exception as e:
        return jsonify({'error': f'DB update error: {e}'}), 500
    try: _broadcast_cards_changed('any')
    except Exception: pass
    return jsonify(serialize_card(doc))

if __name__ == '__main__':
    app.run('0.0.0.0', port=5000, debug=True)

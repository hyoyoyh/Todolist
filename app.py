from flask import Flask, render_template, jsonify, request, session, redirect, url_for, Response, stream_with_context
import hashlib
import os
import json
import time
import queue
import threading
from datetime import datetime, timedelta
from threading import Lock
import secrets
import uuid

app = Flask(__name__)

# ---------------- 기본 설정 ----------------
app.secret_key = secrets.token_hex(32)
app.config['SESSION_COOKIE_NAME'] = 'todolist_session'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)

# ---------------- JSON 기반 로컬 데이터베이스 ----------------
DATA_DIR = "data"
os.makedirs(DATA_DIR, exist_ok=True)

def load_json(filename):
    path = os.path.join(DATA_DIR, filename)
    if not os.path.exists(path):
        return None  # 파일이 없으면 None 반환
    with open(path, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return None  # 파일이 손상되었으면 None 반환

def save_json(filename, data):
    path = os.path.join(DATA_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def datetime_local_to_timestamp(datetime_input):
    if not datetime_input:
        return None
    if isinstance(datetime_input, (int, float)):
        return int(datetime_input)
    if isinstance(datetime_input, str):
        try:
            dt = datetime.strptime(datetime_input, '%Y-%m-%dT%H:%M')
            return int(dt.timestamp())
        except Exception:
            return None
    return None

# ---------------- 유저 관리 ----------------
def find_user(username):
    users = load_json("users.json")
    for user in users:
        if user["username"] == username:
            return user
    return None

@app.route('/', methods=['GET', 'POST'])
def Login():
    if 'username' in session:
        return redirect(url_for('home'))

    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        user = find_user(username)
        if not user:
            return jsonify({'result': 'fail', 'message': '아이디가 존재하지 않습니다.'})
        if user['password'] != hashlib.sha256(password.encode()).hexdigest():
            return jsonify({'result': 'fail', 'message': '비밀번호가 틀렸습니다.'})
        session['username'] = username
        session['user_id'] = user['id']
        return jsonify({'result': 'success', 'message': '로그인 성공'})
    return render_template('login.html')

@app.route('/check_username', methods=['POST'])
def check_username():
    username = request.form.get('username', '').strip()
    if not username:
        return jsonify({'result': 'fail', 'message': '아이디를 입력하세요.'})
        
    if len(username) < 3 or len(username) > 20:
        return jsonify({'result': 'fail', 'message': '아이디는 3~20자여야 합니다.'})
        
    users = load_json("users.json")
    if any(u["username"] == username for u in users):
        return jsonify({'result': 'fail', 'message': '이미 존재하는 아이디입니다.'})
        
    return jsonify({'result': 'success', 'message': '사용 가능한 아이디입니다.'})

@app.route('/register', methods=['GET', 'POST'])
def Register():
    if request.method == 'POST':
        username = request.form.get('reg-username', '').strip()
        password = request.form.get('reg-password', '')
        password_confirm = request.form.get('reg-password-confirm', '')
        if not username or not password:
            return jsonify({'result': 'fail', 'message': '모든 필드를 입력하세요.'})
        if password != password_confirm:
            return jsonify({'result': 'fail', 'message': '비밀번호가 일치하지 않습니다.'})
        users = load_json("users.json")
        if any(u["username"] == username for u in users):
            return jsonify({'result': 'fail', 'message': '이미 존재하는 아이디입니다.'})
        new_user = {
            "id": str(uuid.uuid4()),
            "username": username,
            "password": hashlib.sha256(password.encode()).hexdigest()
        }
        users.append(new_user)
        save_json("users.json", users)
        return jsonify({'result': 'success', 'message': '회원가입 성공'})
    register_data = {
        'title': 'Todo List'
    }
    return render_template('register.html', register_data=register_data)

@app.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'result': 'success', 'message': '로그아웃 되었습니다.'})

# ---------------- 카드 관리 ----------------
def get_cards():
    cards = load_json("cards.json")
    if cards is None:  # load_json이 None을 반환하면 (파일이 없는 경우)
        cards = []     # 빈 배열로 초기화
        save_cards(cards)  # 파일 생성
    return cards

def save_cards(cards):
    save_json("cards.json", cards)

def get_user_cards(user_id):
    cards = get_cards()
    return [c for c in cards if c['user_id'] == user_id]

@app.route('/api/cards', methods=['GET', 'POST'])
def cards():
    if 'user_id' not in session:
        return jsonify({'error': 'Not logged in'}), 401

    user_id = session['user_id']
    if request.method == 'GET':
        scope = request.args.get('scope', 'my')
        cards = get_cards()
        if scope == 'my':
            cards = [c for c in cards if c['user_id'] == user_id]
        else:
            cards = [c for c in cards if c['user_id'] != user_id and c.get('public')]
        return jsonify(cards)

    # POST (새 카드 추가)
    data = request.get_json(silent=True) or {}
    title = data.get('title', '').strip()
    subtitle = data.get('subtitle', '').strip()
    contents = data.get('contents', [])
    deadline = datetime_local_to_timestamp(data.get('deadline'))
    if not title:
        return jsonify({'error': '제목을 입력하세요.'}), 400
    cards = get_cards()
    new_card = {
        'id': str(uuid.uuid4()),
        'user_id': user_id,
        'username': session.get('username'),
        'title': title,
        'subtitle': subtitle,
        'contents': contents,
        'public': bool(data.get('public', False)),
        'deadline': deadline,
        'createdAt': int(time.time()),
        'updatedAt': int(time.time())
    }
    cards.append(new_card)
    save_cards(cards)
    _broadcast_cards_changed('any')
    return jsonify({'success': True, 'card': new_card}), 201

@app.route('/api/cards/<card_id>', methods=['PUT', 'DELETE'])
def card_detail(card_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Not logged in'}), 401

    cards = get_cards()
    user_id = session['user_id']
    card = next((c for c in cards if c['id'] == card_id and c['user_id'] == user_id), None)
    if not card:
        return jsonify({'error': '권한이 없거나 카드가 존재하지 않습니다.'}), 404

    if request.method == 'DELETE':
        cards = [c for c in cards if c['id'] != card_id]
        save_cards(cards)
        _broadcast_cards_changed('any')
        return jsonify({'ok': True})

    data = request.get_json(silent=True) or {}
    card.update({
        'title': data.get('title', card['title']),
        'subtitle': data.get('subtitle', card['subtitle']),
        'contents': data.get('contents', card['contents']),
        'public': bool(data.get('public', card['public'])),
        'deadline': datetime_local_to_timestamp(data.get('deadline')),
        'updatedAt': int(time.time())
    })
    save_cards(cards)
    _broadcast_cards_changed('any')
    return jsonify(card)

# ---------------- SSE (실시간 갱신) ----------------
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
    payload = json.dumps({'type': 'cards-changed', 'scope': scope, 'ts': int(time.time())})
    with _subs_lock:
        for q in list(_subscribers):
            try:
                q.put_nowait(payload)
            except Exception:
                _subscribers.discard(q)

@app.route('/api/cards/stream')
def cards_stream():
    if 'user_id' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    headers = {'Cache-Control': 'no-cache', 'Connection': 'keep-alive'}
    return Response(stream_with_context(_event_stream()), mimetype='text/event-stream', headers=headers)

# ---------------- 페이지 ----------------
@app.route('/home')
def home():
    if 'username' not in session:
        return redirect(url_for('Login'))
        
    modals = {
        'view_modal': {
            'buttons': [
                {
                    'id': 'closeView',
                    'class': 'secondary',
                    'text': '닫기'
                }
            ]
        }
    }
    
    return render_template('home.html', 
                         user_info={'username': session['username'], 'user_id': session['user_id']},
                         modals=modals)

@app.route('/mylist')
def mylist():
    if 'username' not in session:
        return redirect(url_for('Login'))
        
    modals = {
        'add_modal': {
            'title': '새 카드 추가',
            'fields': [
                {
                    'type': 'text',
                    'id': 'addTodoTitle',
                    'placeholder': '제목'
                },
                {
                    'type': 'textarea',
                    'id': 'addTodoDesc',
                    'rows': 2,
                    'placeholder': '부제목 (선택사항)'
                },
                {
                    'type': 'select',
                    'id': 'addTodoVisibility',
                    'label': '공개 설정',
                    'options': [
                        {'value': 'private', 'text': '비공개'},
                        {'value': 'public', 'text': '공개'}
                    ]
                },
                {
                    'type': 'datetime-local',
                    'id': 'addTodoDeadline',
                    'label': '마감일 (선택사항)'
                }
            ],
            'buttons': [
                {
                    'class': 'secondary',
                    'id': 'closeAdd',
                    'text': '취소'
                },
                {
                    'class': 'primary',
                    'id': 'saveAdd',
                    'text': '저장'
                }
            ]
        },
        'edit_modal': {
            'title': '카드 수정',
            'fields': [
                {
                    'type': 'text',
                    'id': 'editTodoTitle',
                    'placeholder': '제목'
                },
                {
                    'type': 'textarea',
                    'id': 'editTodoDesc',
                    'rows': 2,
                    'placeholder': '부제목 (선택사항)'
                },
                {
                    'type': 'select',
                    'id': 'editTodoVisibility',
                    'label': '공개 설정',
                    'options': [
                        {'value': 'private', 'text': '비공개'},
                        {'value': 'public', 'text': '공개'}
                    ]
                },
                {
                    'type': 'datetime-local',
                    'id': 'editTodoDeadline',
                    'label': '마감일 (선택사항)'
                }
            ],
            'buttons': [
                {
                    'class': 'danger',
                    'id': 'deleteEdit',
                    'text': '삭제'
                },
                {
                    'class': 'secondary',
                    'id': 'closeEdit',
                    'text': '취소'
                },
                {
                    'class': 'primary',
                    'id': 'saveEdit',
                    'text': '저장'
                }
            ]
        },
        'view_modal': {
            'buttons': [
                {
                    'class': 'secondary',
                    'id': 'closeView',
                    'text': '닫기'
                }
            ]
        }
    }
    
    return render_template('mylist.html', 
                         user_info={'username': session['username'], 'user_id': session['user_id']},
                         modals=modals)

@app.route('/ranking')
def ranking():
    if 'username' not in session:
        return redirect(url_for('Login'))
    return render_template('ranking.html', user_info={'username': session['username'], 'user_id': session['user_id']})

@app.route('/api/ranking')
def get_ranking():
    if 'user_id' not in session:
        return jsonify({'error': 'Not logged in'}), 401
        
    cards = get_cards()
    user_stats = {}
    
    # 각 유저별 완료된 카드 수 집계
    for card in cards:
        user_id = card['user_id']
        if not user_id in user_stats:
            user_stats[user_id] = {
                'username': card['username'],
                'completedCount': 0
            }
        # 카드의 모든 할일이 완료된 경우에만 카운트
        if card['contents'] and all(item.get('completed', False) for item in card['contents']):
            user_stats[user_id]['completedCount'] += 1
            
    # 리스트로 변환하고 완료 수에 따라 정렬
    ranking = [
        {
            'username': stats['username'],
            'completedCount': stats['completedCount']
        }
        for user_id, stats in user_stats.items()
    ]
    
    ranking.sort(key=lambda x: (-x['completedCount'], x['username']))
    return jsonify(ranking)

if __name__ == '__main__':
    app.run(debug=True)

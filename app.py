import os
import json
import base64
import io
import itertools
from datetime import datetime, timezone, timedelta
from flask import Flask, request, render_template, jsonify, send_file, session, redirect, url_for
import requests
from dotenv import load_dotenv
import uuid
from functools import wraps

load_dotenv()

# --- 환경 변수 설정 ---
API_BEARER_TOKEN = os.getenv('API_BEARER_TOKEN')
API_KEY_ENV = os.getenv("API_KEY")
API_URL_ENV = os.getenv("API_URL")
SITE_PASSWORD = os.getenv("SITE_PASSWORD", "default_password")
ADMIN_KEY = os.getenv('ADMIN_KEY', 'default_admin_key')

# --- 전역 변수 ---
image_gallery = []
user_sessions = {}
banned_ips = set()  # 밴된 IP 목록
image_creators = {}  # 이미지ID: IP 매핑

# --- API 키 관리 ---
API_KEYS = [k.strip() for k in API_KEY_ENV.split(",")] if API_KEY_ENV else []
API_KEY_CYCLE = itertools.cycle(API_KEYS) if API_KEYS else None

# --- Flask 앱 설정 ---
app = Flask(__name__)
app.secret_key = os.urandom(24)

# 파일 업로드 제한 설정
app.config['MAX_CONTENT_LENGTH'] = 15 * 1024 * 1024  # 15MB 제한

# 세션 보안 강화
app.config.update(
    SESSION_COOKIE_SECURE=False,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    PERMANENT_SESSION_LIFETIME=86400
)

# 임시 디렉토리 사용
UPLOAD_FOLDER = '/tmp/uploads'
RESULT_FOLDER = '/tmp/results'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(RESULT_FOLDER, exist_ok=True)

# 메모리에 저장할 데이터
image_gallery = []
like_records = {}

# 한국 시간대 설정
KST = timezone(timedelta(hours=9))

def get_korean_time():
    """현재 한국 시간을 반환"""
    return datetime.now(KST)

# 허용된 이미지 파일 확장자 및 검증 함수
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'svg'}
MAX_FILE_SIZE = 15 * 1024 * 1024  # 15MB

def validate_image_file(file):
    """이미지 파일 유효성 검사"""
    if not file or not file.filename:
        return False, "파일이 선택되지 않았습니다."
    
    # 확장자 검사
    filename_lower = file.filename.lower()
    if '.' not in filename_lower:
        return False, f"파일 확장자가 없습니다: {file.filename}"
    
    ext = filename_lower.rsplit('.', 1)[1]
    if ext not in ALLOWED_EXTENSIONS:
        allowed_list = ', '.join(sorted(ALLOWED_EXTENSIONS))
        return False, f"지원하지 않는 파일 형식입니다. 허용 형식: {allowed_list}"
    
    # MIME 타입 검사
    if not file.content_type or not file.content_type.startswith('image/'):
        return False, f"이미지 파일이 아닙니다: {file.filename}"
    
    # 파일 크기 검사
    file.seek(0, 2)  # 파일 끝으로 이동
    file_size = file.tell()  # 크기 확인
    file.seek(0)  # 다시 처음으로 이동
    
    if file_size == 0:
        return False, f"빈 파일입니다: {file.filename}"
    
    if file_size > MAX_FILE_SIZE:
        size_mb = round(file_size / (1024 * 1024), 2)
        return False, f"파일 크기가 너무 큽니다 ({size_mb}MB). 최대 15MB까지 가능합니다."
    
    return True, "유효한 파일입니다."

# 인증 데코레이터
def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('authenticated'):
            if request.path.startswith('/api/') or request.method == 'POST':
                return jsonify({'error': '인증이 필요합니다.', 'redirect': '/login'}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

def get_client_ip():
    if request.headers.get('X-Forwarded-For'):
        return request.headers.get('X-Forwarded-For').split(',')[0].strip()
    elif request.headers.get('X-Real-IP'):
        return request.headers.get('X-Real-IP')
    else:
        return request.remote_addr

def make_headers():
    headers = {"Content-Type": "application/json"}
    if API_BEARER_TOKEN:
        headers["Authorization"] = f"Bearer {API_BEARER_TOKEN}"
    return headers

def send_request_sync(payload):
    global API_KEYS, API_KEY_CYCLE
    headers = make_headers()

    if API_KEYS:
        keys_to_try = list(API_KEYS)
        for _ in range(len(keys_to_try)):
            key = next(API_KEY_CYCLE)
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key={key}"
            try:
                response = requests.post(url, headers=headers, json=payload, timeout=300)
                
                if response.status_code == 400:
                    data = response.json()
                    if "error" in data:
                        details = data["error"].get("details", [])
                        if any(d.get("reason") == "API_KEY_INVALID" for d in details):
                            print(f"⚠️ Invalid API key 제외: {key}")
                            API_KEYS = [k for k in API_KEYS if k != key]
                            API_KEY_CYCLE = itertools.cycle(API_KEYS) if API_KEYS else None
                            continue

                response.raise_for_status()
                return response.json()
                
            except Exception as e:
                print(f"❌ {url} 요청 실패: {e}")
                continue
        raise RuntimeError("🚨 모든 API KEY 실패")
    else:
        if not API_URL_ENV:
            raise RuntimeError("🚨 API_KEY도 API_URL도 없음. 환경변수 확인하세요.")
        try:
            response = requests.post(API_URL_ENV, headers=headers, json=payload, timeout=300)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            print(f"❌ {API_URL_ENV} 요청 실패: {e}")
            raise

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        password = request.form.get('password', '')
        client_ip = get_client_ip()
        
        # 어드민 키 체크
        is_admin = (password == ADMIN_KEY)
        
        if password == SITE_PASSWORD or is_admin:
            session['authenticated'] = True
            session['admin'] = is_admin  # 어드민 권한 설정
            session.permanent = True
            
            if is_admin:
                print(f"🔑 어드민 로그인: IP={client_ip} 시간={get_korean_time().strftime('%Y-%m-%d %H:%M:%S')}")
            else:
                print(f"✅ 로그인 성공: IP={client_ip} 시간={get_korean_time().strftime('%Y-%m-%d %H:%M:%S')}")
            
            return redirect(url_for('index'))
        else:
            print(f"❌ 로그인 실패: IP={client_ip} 시간={get_korean_time().strftime('%Y-%m-%d %H:%M:%S')}")
            return render_template('login.html', error='잘못된 암호입니다.')
    
    # 이미 인증된 사용자는 메인으로 리다이렉트
    if session.get('authenticated'):
        return redirect(url_for('index'))
    
    return render_template('login.html')

# 로그아웃
@app.route('/logout')
def logout():
    print(f"🚪 로그아웃: IP={get_client_ip()} 시간={get_korean_time().strftime('%Y-%m-%d %H:%M:%S')}")
    session.pop('authenticated', None)
    return redirect(url_for('login'))

@app.before_request
def check_banned_ip():
    """밴된 IP 체크"""
    client_ip = get_client_ip()
    if client_ip and client_ip in banned_ips:
        return jsonify({'error': '접근이 차단되었습니다.'}), 403

# 모든 기존 라우트에 인증 적용
@app.route('/')
@require_auth
def index():
    return render_template('index.html')

@app.route('/gallery')
@require_auth
def gallery():
    return render_template('gallery.html')

# 갤러리 API (무한 스크롤용)
@app.route('/api/gallery')
@require_auth
def api_gallery():
    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 15))
    sort_by = request.args.get('sort', 'newest')
    
    # 정렬
    sorted_gallery = image_gallery.copy()
    
    if sort_by == 'oldest':
        sorted_gallery.sort(key=lambda x: x['created_at'])
    elif sort_by == 'likes':
        sorted_gallery.sort(key=lambda x: x['likes'], reverse=True)
    else:  # newest (default)
        sorted_gallery.sort(key=lambda x: x['created_at'], reverse=True)
    
    # 페이지네이션
    start_index = (page - 1) * per_page
    end_index = start_index + per_page
    page_images = sorted_gallery[start_index:end_index]
    
    # 현재 사용자 IP의 좋아요 기록 확인
    client_ip = get_client_ip()
    user_likes = like_records.get(client_ip, set())
    
    # 각 이미지에 현재 사용자가 좋아요했는지 표시
    for item in page_images:
        item['user_liked'] = item['id'] in user_likes
    
    return jsonify({
        'images': page_images,
        'has_more': end_index < len(sorted_gallery),
        'total': len(sorted_gallery),
        'page': page,
        'per_page': per_page
    })

@app.route('/user_content/<filename>')
@require_auth
def serve_user_content(filename):
    try:
        upload_path = os.path.join(UPLOAD_FOLDER, filename)
        if os.path.exists(upload_path):
            return send_file(upload_path, as_attachment=False)
        
        result_path = os.path.join(RESULT_FOLDER, filename)
        if os.path.exists(result_path):
            return send_file(result_path, as_attachment=False)
        
        return jsonify({'error': '파일을 찾을 수 없습니다.'}), 404
    except Exception as e:
        print(f"파일 서빙 에러: {e}")
        return jsonify({'error': '파일 서빙 중 오류가 발생했습니다.'}), 500

@app.route('/generate', methods=['POST'])
@require_auth
def generate_image():
    try:
        prompt = request.form.get('prompt', '').strip()
        if not prompt:
            return jsonify({'error': '프롬프트를 입력해주세요.'}), 400

        print(f"🎨 이미지 생성 시작: {prompt[:50]}... IP={get_client_ip()} 시간={get_korean_time().strftime('%Y-%m-%d %H:%M:%S')}")
        aspect_ratio = request.form.get('aspect_ratio', 'auto').strip()

        parts = [{"text": f"Image generation prompt: {prompt}"}]
        uploaded_images = []
        
        for i in range(1, 3):
            file_key = f'image{i}'
            if file_key in request.files:
                file = request.files[file_key]
                
                # 파일이 실제로 업로드되었는지 확인
                if file and file.filename:
                    # 파일 유효성 검사
                    is_valid, message = validate_image_file(file)
                    if not is_valid:
                        return jsonify({'error': message}), 400
                    
                    try:
                        image_bytes = file.read()
                        base64_image = base64.b64encode(image_bytes).decode("utf-8")
                        
                        parts.append({
                            "inlineData": {
                                "mimeType": file.content_type,
                                "data": base64_image
                            }
                        })
                        
                        file_id = f"{str(uuid.uuid4())}.png"
                        file_path = os.path.join(UPLOAD_FOLDER, file_id)
                        with open(file_path, 'wb') as f:
                            f.write(image_bytes)
                        
                        uploaded_images.append({
                            'filename': file.filename,
                            'path': f"/user_content/{file_id}"
                        })
                        
                        print(f"📁 파일 업로드 성공: {file.filename} ({round(len(image_bytes)/(1024*1024), 2)}MB)")
                        
                    except Exception as e:
                        print(f"❌ 파일 처리 오류: {e}")
                        return jsonify({'error': f'파일 처리 중 오류가 발생했습니다: {file.filename}'}), 400

        generation_config = {"maxOutputTokens": 4000, "temperature": 1}
        # Conditionally add imageConfig if aspect_ratio is not 'auto'
        allowed_ratios = {"1:1","2:3","3:2","3:4","4:3","4:5","5:4","9:16","16:9","21:9"}
        if aspect_ratio and aspect_ratio.lower() != 'auto' and aspect_ratio in allowed_ratios:
            generation_config["imageConfig"] = {"aspectRatio": aspect_ratio}

        payload = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": generation_config,
            "safetySettings": [
                {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "OFF"},
                {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "OFF"},
                {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "OFF"},
                {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "OFF"},
                {"category": "HARM_CATEGORY_CIVIC_INTEGRITY", "threshold": "OFF"}
            ]
        }

        try:
            data = send_request_sync(payload)
        except Exception as api_error:
            error_msg = str(api_error)
            # Google AI 키 관련 에러는 원본 메시지 그대로 전달
            if "No Google AI keys available" in error_msg or "No billing-enabled Google AI keys available" in error_msg:
                return jsonify({'error': error_msg}), 500
            else:
                # 다른 에러는 기존대로
                raise api_error
        response_text = ""
        result_image_path = None

        if "candidates" in data and data["candidates"]:
            for part in data["candidates"][0]["content"]["parts"]:
                if "text" in part:
                    response_text += part["text"] + "\n"
                elif "inlineData" in part:
                    base64_data = part["inlineData"]["data"]
                    image_data = base64.b64decode(base64_data)
                    
                    result_id = f"{str(uuid.uuid4())}.png"
                    result_path = os.path.join(RESULT_FOLDER, result_id)
                    with open(result_path, 'wb') as f:
                        f.write(image_data)
                    result_image_path = f"/user_content/{result_id}"
                    
                    # 한국 시간으로 저장 (기존 코드에서)
                    korean_time = get_korean_time()
                    client_ip = get_client_ip()
                    
                    gallery_item = {
                        'id': result_id.replace('.png', ''),
                        'result_image': result_image_path,
                        'prompt': prompt,
                        'uploaded_images': uploaded_images,
                        'response_text': response_text.strip(),
                        'created_at': korean_time.isoformat(),
                        'likes': 0,
                        'creator_ip': client_ip  # IP 기록 추가
                    }
                    image_gallery.append(gallery_item)
                    
                    # 이미지ID와 IP 매핑 저장
                    image_creators[gallery_item['id']] = client_ip
                    
                    print(f"✅ 이미지 생성 완료: ID={gallery_item['id']} 한국시간={korean_time.strftime('%Y-%m-%d %H:%M:%S')}")

        if result_image_path:
            return jsonify({
                'success': True,
                'result_image': result_image_path,
                'response_text': response_text.strip()
            })
        else:
            # 🎯 data 응답 안에서 Google AI 키 에러 체크
            data_str = str(data)
            if "No Google AI keys available" in data_str or "No billing-enabled Google AI keys available" in data_str:
                return jsonify({'error': 'No Google AI keys available'}), 500
            else:
                return jsonify({'error': 'AI로부터 이미지를 받지 못했습니다.'}), 500

    except Exception as e:
        print(f"❌ 에러 발생: {e} 시간={get_korean_time().strftime('%Y-%m-%d %H:%M:%S')}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'오류 발생: {str(e)}'}), 500

@app.route('/like/<image_id>', methods=['POST'])
@require_auth
def like_image(image_id):
    client_ip = get_client_ip()
    
    if client_ip not in like_records:
        like_records[client_ip] = set()
    
    if image_id in like_records[client_ip]:
        return jsonify({'error': '이미 좋아요를 누른 이미지입니다.', 'already_liked': True}), 400
    
    for item in image_gallery:
        if item['id'] == image_id:
            item['likes'] += 1
            like_records[client_ip].add(image_id)
            print(f"❤️ 좋아요: ID={image_id} IP={client_ip} 총 좋아요={item['likes']} 시간={get_korean_time().strftime('%Y-%m-%d %H:%M:%S')}")
            return jsonify({
                'success': True, 
                'likes': item['likes'],
                'user_liked': True
            })
    
    return jsonify({'error': '이미지를 찾을 수 없습니다.'}), 404

@app.route('/image/<image_id>')
@require_auth
def get_image_details(image_id):
    client_ip = get_client_ip()
    user_likes = like_records.get(client_ip, set())
    
    for item in image_gallery:
        if item['id'] == image_id:
            item_data = item.copy()
            item_data['user_liked'] = image_id in user_likes
            return jsonify(item_data)
    return jsonify({'error': '이미지를 찾을 수 없습니다.'}), 404

# 에러 핸들러도 인증 체크
@app.errorhandler(401)
def unauthorized(error):
    return redirect(url_for('login'))

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({'error': '파일 크기가 너무 큽니다. 최대 15MB까지 업로드 가능합니다.'}), 413

@app.route('/api/admin/delete_images', methods=['POST'])
@require_auth
def admin_delete_images():
    """어드민 이미지 삭제"""
    if not session.get('admin'):
        return jsonify({'error': '어드민 권한이 필요합니다.'}), 403
    
    try:
        data = request.get_json()
        image_ids = data.get('image_ids', [])
        ban_users = data.get('ban_users', False)
        
        if not image_ids:
            return jsonify({'error': '삭제할 이미지를 선택해주세요.'}), 400
        
        deleted_count = 0
        banned_ips_count = 0
        creator_ips = set()
        
        # 이미지 삭제 및 IP 수집
        global image_gallery
        new_gallery = []
        
        for item in image_gallery:
            if item['id'] in image_ids:
                # 파일 삭제
                try:
                    file_path = item['result_image'].replace('/user_content/', '')
                    result_path = os.path.join(RESULT_FOLDER, file_path)
                    if os.path.exists(result_path):
                        os.remove(result_path)
                    
                    # 첨부 이미지도 삭제
                    if item.get('uploaded_images'):
                        for img in item['uploaded_images']:
                            img_path = img['path'].replace('/user_content/', '')
                            upload_path = os.path.join(UPLOAD_FOLDER, img_path)
                            if os.path.exists(upload_path):
                                os.remove(upload_path)
                except Exception as e:
                    print(f"파일 삭제 오류: {e}")
                
                # IP 수집
                creator_ip = item.get('creator_ip') or image_creators.get(item['id'])
                if creator_ip:
                    creator_ips.add(creator_ip)
                
                deleted_count += 1
            else:
                new_gallery.append(item)
        
        image_gallery = new_gallery
        
        # IP 밴 처리
        if ban_users and creator_ips:
            banned_ips.update(creator_ips)
            banned_ips_count = len(creator_ips)
            print(f"🚫 IP 밴: {creator_ips}")
        
        admin_ip = get_client_ip()
        print(f"🗑️ 어드민 삭제: {deleted_count}개 이미지, {banned_ips_count}개 IP 밴 (어드민: {admin_ip})")
        
        return jsonify({
            'success': True,
            'deleted_count': deleted_count,
            'banned_ips_count': banned_ips_count
        })
        
    except Exception as e:
        print(f"어드민 삭제 오류: {e}")
        return jsonify({'error': '삭제 중 오류가 발생했습니다.'}), 500

@app.route('/api/admin/status')
@require_auth  
def admin_status():
    """어드민 상태 체크"""
    return jsonify({
        'is_admin': session.get('admin', False),
        'banned_ips_count': len(banned_ips),
        'total_images': len(image_gallery)
    })

# 서버 상태 체크 (선택사항)
@app.route('/health')
def health_check():
    return jsonify({
        'status': 'healthy',
        'server_time_kst': get_korean_time().strftime('%Y-%m-%d %H:%M:%S'),
        'total_images': len(image_gallery),
        'total_likes': sum(item['likes'] for item in image_gallery)
    })

if __name__ == '__main__':
    print("🚀 Flask 앱 시작 중...")
    print(f"🔐 사이트 암호가 설정되었습니다.")
    print(f"🇰🇷 서버 시간: {get_korean_time().strftime('%Y-%m-%d %H:%M:%S KST')}")
    print(f"📁 업로드 폴더: {UPLOAD_FOLDER}")
    print(f"📁 결과 폴더: {RESULT_FOLDER}")
    app.run(host="0.0.0.0", port=7860, debug=True)

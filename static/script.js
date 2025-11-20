let currentImageId = null;

document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('imageForm');
    const generateBtn = document.getElementById('generateBtn');
    const loading = document.getElementById('loading');
    const result = document.getElementById('result');

    // 폼 제출
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        generateBtn.disabled = true;
        loading.classList.remove('hidden');
        result.classList.add('hidden');
    
        const formData = new FormData(form);
    
        try {
            const response = await fetch('/generate', {
                method: 'POST',
                body: formData
            });
        
            const data = await response.json();
        
            if (data.success) {
                document.getElementById('resultImage').src = data.result_image;
                document.getElementById('resultText').textContent = data.response_text || 'AI가 이미지를 생성했습니다.';
                result.classList.remove('hidden');
            } else {
                // 🎯 여러 방법으로 키 소진 체크
                const checkNoKeys = (obj) => {
                    const regex = /No.*Google AI keys available/i;
                    
                    // 1. 전체 객체를 문자열로 변환해서 체크
                    if (regex.test(JSON.stringify(obj))) {
                        return true;
                    }
                    
                    // 2. error.message 체크
                    if (obj.error && obj.error.message && regex.test(obj.error.message)) {
                        return true;
                    }
                    
                    // 3. 단순 error 문자열 체크  
                    if (typeof obj.error === 'string' && regex.test(obj.error)) {
                        return true;
                    }
                    
                    return false;
                };
                
                if (checkNoKeys(data)) {
                    alert('🍽️ 급식소 배급이 종료되었습니다. 다음기회에!');
                } else {
                    alert('오류: ' + (data.error?.message || data.error || '알 수 없는 오류'));
                }
            }
        } catch (error) {
            console.error('요청 오류:', error);
            
            // 🎯 에러도 동일하게 체크
            const noKeysRegex = /No.*Google AI keys available/i;
            
            if (noKeysRegex.test(error.toString()) || noKeysRegex.test(error.message || '')) {
                alert('🍽️ 급식소 배급이 종료되었습니다. 다음기회에!');
            } else {
                alert('요청 중 오류가 발생했습니다: ' + error.message);
            }
        } finally {
            loading.classList.add('hidden');
            generateBtn.disabled = false;
        }
    });
});

function previewImage(input, previewId) {
    const preview = document.getElementById(previewId);
    preview.innerHTML = '';

    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = document.createElement('img');
            img.src = e.target.result;
            preview.appendChild(img);
        };
        reader.readAsDataURL(input.files[0]);
    }
}

function resetForm() {
    // 폼 리셋
    document.getElementById('imageForm').reset();
    
    // 미리보기 이미지 제거
    document.getElementById('preview1').innerHTML = '';
    document.getElementById('preview2').innerHTML = '';
    
    // 파일 상태 초기화 추가
    uploadedFiles = [null, null];
    updateDropZoneState(1, false);
    updateDropZoneState(2, false);
    
    // 결과 섹션 숨기기
    document.getElementById('result').classList.add('hidden');
    
    // 프롬프트 입력칸에 포커스
    document.getElementById('prompt').focus();
}

// 드래그 앤 드롭 및 복사붙여넣기 기능
let dragOverlay = null;
let uploadedFiles = [null, null]; // 두 슬롯 관리

// 페이지 로드시 초기화
document.addEventListener('DOMContentLoaded', function() {
    // 드래그 오버레이 생성
    dragOverlay = document.createElement('div');
    dragOverlay.className = 'drag-overlay';
    dragOverlay.innerHTML = '🖼️ 이미지를 여기에 놓아주세요!';
    document.body.appendChild(dragOverlay);
    
    // 전역 드래그 이벤트
    document.addEventListener('dragenter', handleGlobalDragEnter);
    document.addEventListener('dragover', handleGlobalDragOver);
    document.addEventListener('dragleave', handleGlobalDragLeave);
    document.addEventListener('drop', handleGlobalDrop);
    
    // 복사붙여넣기 이벤트
    document.addEventListener('paste', handlePaste);
});

// 전역 드래그 이벤트 처리
function handleGlobalDragEnter(e) {
    e.preventDefault();
    if (hasImageFiles(e)) {
        dragOverlay.classList.add('show');
    }
}

function handleGlobalDragOver(e) {
    e.preventDefault();
}

function handleGlobalDragLeave(e) {
    e.preventDefault();
    // 화면 밖으로 벗어날 때만 숨기기
    if (e.clientX <= 0 || e.clientY <= 0 || 
        e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        dragOverlay.classList.remove('show');
    }
}

function handleGlobalDrop(e) {
    e.preventDefault();
    dragOverlay.classList.remove('show');
}

// 드래그오버 처리
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const dropZone = e.currentTarget;
    dropZone.classList.add('drag-over');
}

// 드롭 처리
function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const dropZone = e.currentTarget;
    dropZone.classList.remove('drag-over');
    
    // 드래그 오버레이 숨기기 (버그 수정)
    if (dragOverlay) {
        dragOverlay.classList.remove('show');
    }
    
    const files = e.dataTransfer.files;
    const targetSlot = parseInt(dropZone.dataset.target);
    
    if (files.length > 0) {
        processImageFile(files[0], targetSlot);
    }
}

// 드래그 떠날 때
document.addEventListener('dragleave', function(e) {
    const dropZones = document.querySelectorAll('.drop-zone');
    dropZones.forEach(zone => {
        zone.classList.remove('drag-over');
    });
});

// 복사붙여넣기 처리
function handlePaste(e) {
    const items = e.clipboardData.items;
    
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            e.preventDefault();
            
            const file = items[i].getAsFile();
            const availableSlot = getNextAvailableSlot();
            
            if (availableSlot === -1) {
                alert('이미 2개의 이미지가 업로드되었습니다. 먼저 이미지를 제거해주세요.');
                return;
            }
            
            processImageFile(file, availableSlot);
            break;
        }
    }
}

// 이미지 파일 처리
function processImageFile(file, targetSlot) {
    // 파일 유효성 검사
    if (!isValidImageFile(file)) {
        alert('지원하지 않는 파일 형식입니다. (지원: PNG, JPG, JPEG, GIF, BMP, WEBP)');
        return;
    }
    
    // 15MB 체크
    if (file.size > 15 * 1024 * 1024) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
        alert(`파일 크기가 너무 큽니다 (${sizeMB}MB). 최대 15MB까지 가능합니다.`);
        return;
    }
    
    // 파일을 해당 input에 설정
    const fileInput = document.getElementById(`image${targetSlot}`);
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;
    
    // 미리보기 표시
    previewImage(fileInput, `preview${targetSlot}`);
    
    // 상태 업데이트
    uploadedFiles[targetSlot - 1] = file;
    updateDropZoneState(targetSlot, true);
}

// 파일 유효성 검사
function isValidImageFile(file) {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 
                         'image/bmp', 'image/webp', 'image/tiff', 'image/svg+xml'];
    return allowedTypes.includes(file.type);
}

// 드래그된 파일이 이미지인지 확인
function hasImageFiles(e) {
    if (e.dataTransfer.types) {
        return e.dataTransfer.types.includes('Files');
    }
    return false;
}

// 다음 사용 가능한 슬롯 찾기
function getNextAvailableSlot() {
    if (!uploadedFiles[0]) return 1;
    if (!uploadedFiles[1]) return 2;
    return -1; // 모든 슬롯 사용 중
}

// 드롭존 상태 업데이트
function updateDropZoneState(slot, hasFile) {
    const dropZone = document.querySelector(`.drop-zone[data-target="${slot}"]`);
    const removeBtn = dropZone.querySelector('.remove-image');
    
    if (hasFile) {
        dropZone.classList.add('has-file');
        removeBtn.style.display = 'block';
    } else {
        dropZone.classList.remove('has-file');
        removeBtn.style.display = 'none';
    }
}

// 이미지 제거 함수
function removeImage(slot) {
    const fileInput = document.getElementById(`image${slot}`);
    const preview = document.getElementById(`preview${slot}`);
    
    // 파일 입력 초기화
    fileInput.value = '';
    
    // 미리보기 제거
    preview.innerHTML = '';
    
    // 상태 업데이트
    uploadedFiles[slot - 1] = null;
    updateDropZoneState(slot, false);
}

// 기존 previewImage 함수 수정 (있다면)
function previewImage(input, previewId) {
    const preview = document.getElementById(previewId);
    const file = input.files[0];
    
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            preview.innerHTML = `<img src="${e.target.result}" alt="미리보기">`;
        };
        reader.readAsDataURL(file);
        
        // 슬롯 번호 추출
        const slot = parseInt(previewId.replace('preview', ''));
        uploadedFiles[slot - 1] = file;
        updateDropZoneState(slot, true);
    } else {
        preview.innerHTML = '';
        const slot = parseInt(previewId.replace('preview', ''));
        uploadedFiles[slot - 1] = null;
        updateDropZoneState(slot, false);
    }
}

 // 사이드바 토글 기능
document.addEventListener('DOMContentLoaded', function() {
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarOpenBtn = document.getElementById('sidebarOpenBtn');
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.querySelector('.main-content');
    
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', function() {
            sidebar.classList.add('collapsed');
            mainContent.classList.add('expanded');
            sidebarOpenBtn.style.display = 'flex';
        });
    }
    
    if (sidebarOpenBtn) {
        sidebarOpenBtn.addEventListener('click', function() {
            sidebar.classList.remove('collapsed');
            mainContent.classList.remove('expanded');
            sidebarOpenBtn.style.display = 'none';
        });
    }
});

// 크기(가로세로비) 선택 UI
document.addEventListener('DOMContentLoaded', function() {
    const aspectSelector = document.getElementById('aspectSelector');
    const aspectToggle = document.getElementById('aspectToggle');
    const aspectMenu = document.getElementById('aspectMenu');
    const aspectInput = document.getElementById('aspect_ratio');

    if (!aspectSelector || !aspectToggle || !aspectMenu || !aspectInput) return;

    // 기본값: Auto (백엔드에서는 imageConfig 미포함)
    aspectInput.value = '';
    aspectToggle.textContent = '크기: Auto';

    // 토글 버튼 클릭 시 메뉴 열기/닫기
    aspectToggle.addEventListener('click', function(e) {
        e.stopPropagation();
        aspectSelector.classList.toggle('open');
    });

    // 리스트 항목 클릭 시 값 반영
    aspectMenu.addEventListener('click', function(e) {
        const item = e.target.closest('li');
        if (!item) return;
        const value = item.dataset.value;

        if (value === 'auto') {
            aspectInput.value = ''; // Auto는 비워서 전송(백엔드에서 imageConfig 생략)
            aspectToggle.textContent = '크기: Auto';
        } else {
            aspectInput.value = value;
            aspectToggle.textContent = '크기: ' + value;
        }
        aspectSelector.classList.remove('open');
    });

    // 바깥 클릭 시 닫기
    document.addEventListener('click', function(e) {
        if (!aspectSelector.contains(e.target)) {
            aspectSelector.classList.remove('open');
        }
    });
});

// 이미지 사이즈 선택 UI
document.addEventListener('DOMContentLoaded', function() {
    const imageSizeSelector = document.getElementById('imageSizeSelector');
    const imageSizeToggle = document.getElementById('imageSizeToggle');
    const imageSizeMenu = document.getElementById('imageSizeMenu');
    const imageSizeInput = document.getElementById('image_size');

    if (!imageSizeSelector || !imageSizeToggle || !imageSizeMenu || !imageSizeInput) return;

    // 기본값: 1K
    imageSizeInput.value = '1K';
    imageSizeToggle.textContent = '해상도: 1K';

    // 토글 버튼 클릭 시 메뉴 열기/닫기
    imageSizeToggle.addEventListener('click', function(e) {
        e.stopPropagation();
        imageSizeSelector.classList.toggle('open');
    });

    // 리스트 항목 클릭 시 값 반영
    imageSizeMenu.addEventListener('click', function(e) {
        const item = e.target.closest('li');
        if (!item) return;
        const value = item.dataset.value;

        imageSizeInput.value = value;
        imageSizeToggle.textContent = '해상도: ' + value;
        imageSizeSelector.classList.remove('open');
    });

    // 바깥 클릭 시 닫기
    document.addEventListener('click', function(e) {
        if (!imageSizeSelector.contains(e.target)) {
            imageSizeSelector.classList.remove('open');
        }
    });
});

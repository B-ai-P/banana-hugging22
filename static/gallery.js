let currentImageId = null;
let userLikedImages = new Set();
let currentPage = 1;
let currentSort = 'newest';
let isLoading = false;
let hasMore = true;

// 행별 그리드 레이아웃 클래스
class RowGridLayout {
    constructor(container, options = {}) {
        this.container = container;
        this.itemsPerRow = this.getItemsPerRow();
        this.currentRow = null;
        this.itemsInCurrentRow = 0;
        this.resizeTimeout = null;
        
        // 리사이즈 이벤트
        window.addEventListener('resize', () => {
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => {
                this.handleResize();
            }, 150);
        });
    }
    
    getItemsPerRow() {
        const width = window.innerWidth;
        if (width <= 480) return 1;
        if (width <= 768) return 2; 
        if (width <= 1200) return 3;
        return 4;
    }
    
    addItem(element) {
        // 새 행이 필요한지 확인
        if (!this.currentRow || this.itemsInCurrentRow >= this.itemsPerRow) {
            this.createNewRow();
        }
        
        this.currentRow.appendChild(element);
        this.itemsInCurrentRow++;
    }
    
    createNewRow() {
        this.currentRow = document.createElement('div');
        this.currentRow.className = 'gallery-row';
        this.container.appendChild(this.currentRow);
        this.itemsInCurrentRow = 0;
    }
    
    clear() {
        this.container.innerHTML = '';
        this.currentRow = null;
        this.itemsInCurrentRow = 0;
    }
    
    handleResize() {
        const newItemsPerRow = this.getItemsPerRow();
        if (newItemsPerRow !== this.itemsPerRow) {
            this.itemsPerRow = newItemsPerRow;
            this.relayout();
        }
    }
    
    relayout() {
        // 모든 아이템 수집
        const allItems = Array.from(this.container.querySelectorAll('.gallery-item'));
        
        // 컨테이너 초기화
        this.clear();
        
        // 아이템들을 새로운 행 구조로 재배치
        allItems.forEach(item => {
            this.addItem(item);
        });
    }
}

let gridInstance = null;

// 사이드바 이벤트 설정
function setupSidebarEvents() {
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarOpenBtn = document.getElementById('sidebarOpenBtn');
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.querySelector('.main-content');
    
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', function() {
            sidebar.classList.add('collapsed');
            mainContent.classList.add('expanded');
            sidebarOpenBtn.style.display = 'block';
        });
    }
    
    if (sidebarOpenBtn) {
        sidebarOpenBtn.addEventListener('click', function() {
            sidebar.classList.remove('collapsed');
            mainContent.classList.remove('expanded');
            sidebarOpenBtn.style.display = 'none';
        });
    }
    
    // 모바일에서 오버레이 클릭시 사이드바 닫기
    if (window.innerWidth <= 768) {
        mainContent.addEventListener('click', function() {
            if (!sidebar.classList.contains('collapsed')) {
                sidebar.classList.add('collapsed');
                sidebarOpenBtn.style.display = 'block';
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', function() {
    // 그리드 인스턴스 생성
    const gallery = document.getElementById('gallery');
    if (!gallery) {
        console.error('Gallery container not found!');
        return;
    }
    
    gridInstance = new RowGridLayout(gallery);
    
    // 초기 이미지 로드
    loadImages(true);

    // 어드민 상태 체크  👈 여기 추가!
    checkAdminStatus();
    
    // 어드민 이벤트 리스너  👈 여기 추가!
    setupAdminEvents();

    // 사이드바 이벤트 리스너 추가
    setupSidebarEvents();
    
    // 정렬 버튼 이벤트
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            if (this.classList.contains('active')) return;
            
            document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            currentSort = this.dataset.sort;
            currentPage = 1;
            hasMore = true;
            gridInstance.clear();
            loadImages(true);
        });
    });
    
    // 스크롤 이벤트
    let ticking = false;
    let lastScrollTop = 0;
    
    window.addEventListener('scroll', function() {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        
        if (scrollTop > lastScrollTop && !ticking) {
            requestAnimationFrame(() => {
                if (isLoading || !hasMore) {
                    ticking = false;
                    return;
                }
                
                if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 1500) {
                    loadImages(false);
                }
                ticking = false;
            });
            ticking = true;
        }
        lastScrollTop = scrollTop;
    });
    
    // ESC 키로 모달 닫기
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeModal();
        }
    });
});

async function loadImages(isInitial = false) {
    if (isLoading) return;
    
    isLoading = true;
    const loadingMore = document.getElementById('loadingMore');
    const emptyGallery = document.getElementById('emptyGallery');
    const endMessage = document.getElementById('endMessage');
    
    if (!isInitial && loadingMore) {
        loadingMore.classList.remove('hidden');
    }
    
    try {
        const response = await fetch(`/api/gallery?page=${currentPage}&per_page=15&sort=${currentSort}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.images && data.images.length > 0) {
            await appendImagesWithGrid(data.images);
            
            hasMore = data.has_more;
            currentPage++;
            
            if (emptyGallery) emptyGallery.classList.add('hidden');
            
            if (!hasMore && endMessage) {
                endMessage.classList.remove('hidden');
            }
        } else if (isInitial && emptyGallery) {
            emptyGallery.classList.remove('hidden');
        }
        
    } catch (error) {
        console.error('이미지 로드 오류:', error);
        
        if (error.message.includes('401')) {
            alert('로그인이 필요합니다. 페이지를 새로고침하세요.');
            window.location.reload();
        } else {
            alert('이미지를 불러오는데 실패했습니다. 잠시 후 다시 시도해주세요.');
        }
    } finally {
        isLoading = false;
        if (loadingMore) loadingMore.classList.add('hidden');
    }
}

async function appendImagesWithGrid(images) {
    const imagePromises = images.map((image, index) => {
        return new Promise((resolve) => {
            const galleryItem = document.createElement('div');
            galleryItem.className = 'gallery-item';
            
            // 스켈레톤 먼저 표시
            galleryItem.innerHTML = `
                <div class="image-container loading">
                    <div class="image-loading-text">로딩중...</div>
                    <img src="" alt="생성된 이미지" style="display: none;">
                    <div class="image-overlay">
                        <div class="like-info">
                            <span class="like-count clickable-like" data-image-id="${image.id}" onclick="quickLike(event, '${image.id}')">❤️ ${image.likes || 0}</span>
                        </div>
                        <div class="image-prompt">
                            <p>${image.prompt && image.prompt.length > 50 ? image.prompt.substring(0, 50) + '...' : (image.prompt || '')}</p>
                        </div>
                    </div>
                </div>
            `;
            
            // 그리드에 추가
            gridInstance.addItem(galleryItem);
            
            // 이미지 미리 로드
            const img = galleryItem.querySelector('img');
            const container = galleryItem.querySelector('.image-container');
            const loadingText = galleryItem.querySelector('.image-loading-text');
            
            const preloadImg = new Image();
            preloadImg.onload = () => {
                // 이미지 비율 계산
                const ratio = preloadImg.width / preloadImg.height;
                
                // 비율에 따라 클래스 추가
                if (ratio > 1.3) {
                    container.classList.add('landscape');
                } else if (ratio < 0.8) {
                    container.classList.add('portrait');
                } else {
                    container.classList.add('square');
                }
                
                img.src = image.result_image;
                img.style.display = 'block';
                
                setTimeout(() => {
                    img.classList.add('loaded');
                    container.classList.remove('loading');
                    container.classList.add('loaded');
                    if (loadingText) loadingText.remove();
                    
                    // 클릭 이벤트 추가
                    galleryItem.onclick = function(event) {
                        // 🎯 선택 모드가 아닐 때만 모달 열기
                        if (!isSelectMode) {
                            openModal(image.id);
                        }
                    };
                }, 50);  // 🎯 여기에 }); 추가!
                
                resolve();
            };
            
            preloadImg.onerror = () => {
                if (loadingText) {
                    loadingText.textContent = '로드 실패';
                    loadingText.style.color = '#ef4444';
                }
                container.classList.remove('loading');
                resolve();
            };
            
            setTimeout(() => {
                preloadImg.src = image.result_image;
            }, index * 50);
        });
    });
    
    return Promise.resolve();
}

// 나머지 함수들 (openModal, closeModal, likeImage, formatDate)는 기존과 동일하게 유지
async function openModal(imageId) {
    if (!imageId) return;
    
    currentImageId = imageId;
    
    try {
        const response = await fetch(`/image/${imageId}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        const modalImg = document.getElementById('modalImage');
        const preloadImg = new Image();
        
        preloadImg.onload = () => {
            modalImg.src = data.result_image;
            modalImg.style.opacity = '1';
        };
        
        preloadImg.onerror = () => {
            modalImg.style.opacity = '1';
            modalImg.alt = '이미지 로드 실패';
        };
        
        modalImg.style.opacity = '0.5';
        preloadImg.src = data.result_image;
        
        document.getElementById('modalDate').textContent = formatDate(data.created_at);
        document.getElementById('likeCount').textContent = data.likes || 0;
        document.getElementById('modalPrompt').textContent = data.prompt || '';
        document.getElementById('modalResponse').textContent = data.response_text || 'AI가 이미지를 생성했습니다.';

        const likeBtn = document.getElementById('likeBtn');
        if (data.user_liked) {
            likeBtn.classList.add('liked', 'disabled');
            likeBtn.style.background = '#fef2f2';
            likeBtn.style.borderColor = '#fca5a5';
            likeBtn.style.color = '#dc2626';
        } else {
            likeBtn.classList.remove('liked', 'disabled');
            likeBtn.style.background = '#f1f5f9';
            likeBtn.style.borderColor = '#cbd5e1';
            likeBtn.style.color = '#475569';
        }

        const modalImages = document.getElementById('modalImages');
        modalImages.innerHTML = '';
        if (data.uploaded_images && data.uploaded_images.length > 0) {
            data.uploaded_images.forEach(img => {
                const imgElement = document.createElement('img');
                imgElement.src = img.path;
                imgElement.alt = img.filename || '첨부 이미지';
                imgElement.title = img.filename || '첨부 이미지';
                imgElement.onerror = function() {
                    this.style.display = 'none';
                };
                modalImages.appendChild(imgElement);
            });
        }

        document.getElementById('imageModal').style.display = 'block';
        document.body.style.overflow = 'hidden';
        
    } catch (error) {
        console.error('모달 오류:', error);
        alert('이미지 정보를 불러올 수 없습니다.');
    }
}

function closeModal() {
    const modal = document.getElementById('imageModal');
    if (modal) {
        modal.style.display = 'none';
    }
    document.body.style.overflow = 'auto';
    currentImageId = null;
}

async function likeImage() {
    if (!currentImageId) return;
    
    const likeBtn = document.getElementById('likeBtn');
    if (likeBtn.classList.contains('disabled')) return;

    try {
        const response = await fetch(`/like/${currentImageId}`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();

        if (data.success) {
            document.getElementById('likeCount').textContent = data.likes;
            likeBtn.classList.add('liked', 'disabled');
            likeBtn.style.background = '#fef2f2';
            likeBtn.style.borderColor = '#fca5a5';
            likeBtn.style.color = '#dc2626';
            
            // 갤러리에서도 업데이트
            document.querySelectorAll(`[data-image-id="${currentImageId}"]`).forEach(el => {
                el.textContent = `❤️ ${data.likes}`;
                el.classList.add('liked');
            });
        } else {
            if (data.already_liked) {
                alert('이미 좋아요를 누른 이미지입니다!');
            } else {
                alert(data.error || '좋아요 처리 중 오류가 발생했습니다.');
            }
        }
    } catch (error) {
        console.error('좋아요 오류:', error);
        alert('좋아요 처리 중 오류가 발생했습니다.');
    }
}

function formatDate(dateString) {
    if (!dateString) return '';
    
    try {
        const date = new Date(dateString);
        
        if (isNaN(date.getTime())) {
            return dateString;
        }
        
        const options = {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        };
        
        return date.toLocaleString('ko-KR', options);
    } catch (error) {
        console.error('날짜 포맷 오류:', error);
        return dateString;
    }
}

// 갤러리에서 바로 좋아요 누르기
async function quickLike(event, imageId) {
    event.stopPropagation(); // 모달 열리지 않게 방지
    
    const likeElement = event.target;
    if (likeElement.classList.contains('liked') || likeElement.classList.contains('processing')) {
        return; // 이미 좋아요 누름 or 처리 중
    }
    
    likeElement.classList.add('processing');
    
    try {
        const response = await fetch(`/like/${imageId}`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            // 성공 처리
            likeElement.textContent = `❤️ ${data.likes}`;
            likeElement.classList.add('liked');
            
            document.querySelectorAll(`[data-image-id="${imageId}"]`).forEach(el => {
                el.textContent = `❤️ ${data.likes}`;
                el.classList.add('liked');
            });
            
            console.log(`✅ 좋아요 성공: ${imageId} -> ${data.likes}개`);
        } else if (data.already_liked || (data.error && data.error.includes('already'))) {
            // 🎯 이미 좋아요 - 개수는 그대로, 상태만 변경
            likeElement.classList.add('liked');
            
            document.querySelectorAll(`[data-image-id="${imageId}"]`).forEach(el => {
                el.classList.add('liked');
            });
            
            alert('이미 하트를 누르셨습니다.');
        } else {
            // 진짜 오류
            throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
        }
    } catch (error) {
        console.error('좋아요 오류:', error);
        alert('좋아요 처리 중 오류가 발생했습니다.');
    } finally {
        likeElement.classList.remove('processing');
    }
}

// 어드민 상태 체크
async function checkAdminStatus() {
    try {
        const response = await fetch('/api/admin/status');
        const data = await response.json();
        
        if (data.is_admin) {
            // 🎯 기존 adminPanel 대신 adminPanelFixed 사용
            document.getElementById('adminPanelFixed').style.display = 'block';
            console.log('🔑 어드민 권한 확인됨');
        }
    } catch (error) {
        console.error('어드민 상태 체크 오류:', error);
    }
}

// 어드민 이벤트 설정
function setupAdminEvents() {
    const selectModeBtn = document.getElementById('selectModeBtn');
    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    const cancelSelectBtn = document.getElementById('cancelSelectBtn');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    
    if (selectModeBtn) {
        selectModeBtn.addEventListener('click', toggleSelectMode);
    }
    
    if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', showDeleteModal);
    }
    
    if (cancelSelectBtn) {
        cancelSelectBtn.addEventListener('click', exitSelectMode);
    }
    
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', executeDelete);
    }
    
    if (cancelDeleteBtn) {
        cancelDeleteBtn.addEventListener('click', hideDeleteModal);
    }
}

let isSelectMode = false;
let selectedImages = new Set();

// 선택 모드 토글
function toggleSelectMode() {
    isSelectMode = !isSelectMode;
    
    const selectModeBtn = document.getElementById('selectModeBtn');
    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    const cancelSelectBtn = document.getElementById('cancelSelectBtn');
    const selectedCount = document.getElementById('selectedCount');
    
    if (isSelectMode) {
        selectModeBtn.style.display = 'none';
        deleteSelectedBtn.style.display = 'inline-block';
        cancelSelectBtn.style.display = 'inline-block';
        selectedCount.style.display = 'inline-block';
        
        // 모든 이미지에 선택 가능 클래스 추가
        document.querySelectorAll('.gallery-item').forEach(item => {
            item.classList.add('selectable');
            item.addEventListener('click', toggleImageSelection);
        });
        
        console.log('🎯 다중선택 모드 활성화');
    } else {
        exitSelectMode();
    }
}

// 선택 모드 종료
function exitSelectMode() {
    isSelectMode = false;
    selectedImages.clear();
    
    const selectModeBtn = document.getElementById('selectModeBtn');
    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    const cancelSelectBtn = document.getElementById('cancelSelectBtn');
    const selectedCount = document.getElementById('selectedCount');
    
    selectModeBtn.style.display = 'inline-block';
    deleteSelectedBtn.style.display = 'none';
    cancelSelectBtn.style.display = 'none';
    selectedCount.style.display = 'none';
    
    // 선택 상태 초기화
    document.querySelectorAll('.gallery-item').forEach(item => {
        item.classList.remove('selectable', 'selected');
        item.removeEventListener('click', toggleImageSelection);
    });
    
    updateSelectedCount();
    console.log('❌ 다중선택 모드 비활성화');
}

// 이미지 선택 토글
function toggleImageSelection(event) {
    if (!isSelectMode) return;
    
    event.preventDefault(); // 🎯 기본 동작 방지
    event.stopPropagation(); // 🎯 이벤트 전파 방지
    
    const galleryItem = event.currentTarget;
    const img = galleryItem.querySelector('img');
    
    if (!img || !img.src) return;
    
    // 이미지 ID 추출 (src에서)
    const imageId = extractImageIdFromSrc(img.src);
    
    if (galleryItem.classList.contains('selected')) {
        galleryItem.classList.remove('selected');
        selectedImages.delete(imageId);
    } else {
        galleryItem.classList.add('selected');
        selectedImages.add(imageId);
    }
    
    updateSelectedCount();
}

// 이미지 ID 추출
function extractImageIdFromSrc(src) {
    const filename = src.split('/').pop();
    return filename.replace('.png', '');
}

// 선택 개수 업데이트
function updateSelectedCount() {
    const selectedCount = document.getElementById('selectedCount');
    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    
    if (selectedCount) {
        selectedCount.textContent = `${selectedImages.size}개 선택됨`;
    }
    
    if (deleteSelectedBtn) {
        deleteSelectedBtn.disabled = selectedImages.size === 0;
    }
}

// 삭제 모달 표시
function showDeleteModal() {
    if (selectedImages.size === 0) {
        alert('삭제할 이미지를 선택해주세요.');
        return;
    }
    
    document.getElementById('deleteCount').textContent = selectedImages.size;
    document.getElementById('deleteModal').style.display = 'block';
}

// 삭제 모달 숨기기
function hideDeleteModal() {
    document.getElementById('deleteModal').style.display = 'none';
}

// 삭제 실행
async function executeDelete() {
    const deleteOption = document.querySelector('input[name="deleteOption"]:checked').value;
    const banUsers = (deleteOption === 'delete_and_ban');
    const imageIds = Array.from(selectedImages);
    
    try {
        const response = await fetch('/api/admin/delete_images', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                image_ids: imageIds,
                ban_users: banUsers
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ ${data.deleted_count}개 이미지 삭제 완료${banUsers ? `, ${data.banned_ips_count}개 IP 차단` : ''}`);
            
            hideDeleteModal();
            exitSelectMode();
            
            // 페이지 새로고침으로 갤러리 업데이트
            window.location.reload();
        } else {
            alert('삭제 실패: ' + data.error);
        }
    } catch (error) {
        console.error('삭제 오류:', error);
        alert('삭제 중 오류가 발생했습니다.');
    }
}

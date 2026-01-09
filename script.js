/**
 * Gemini Watermark Tool - Frontend Implementation
 * Based on https://github.com/allenk/GeminiWatermarkTool
 */

class WatermarkProcessor {
    constructor() {
        this.alphaMap48 = null;
        this.alphaMap96 = null;
        this.isReady = false;
        this.init();
    }

    async init() {
        try {
            this.alphaMap48 = await this.loadAlphaMap('assets/bg_48.png');
            this.alphaMap96 = await this.loadAlphaMap('assets/bg_96.png');
            this.isReady = true;
            console.log('WatermarkProcessor: Alpha maps loaded.');
        } catch (error) {
            console.error('WatermarkProcessor: Failed to load alpha maps', error);
        }
    }

    async loadAlphaMap(url) {
        const img = new Image();
        img.src = url;
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
        });

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        
        // Convert to Float32Array alpha (0.0 - 1.0)
        // Original C++: alpha = max(R, G, B) / 255.0
        const alpha = new Float32Array(img.width * img.height);
        for (let i = 0; i < imageData.data.length; i += 4) {
            const r = imageData.data[i];
            const g = imageData.data[i+1];
            const b = imageData.data[i+2];
            alpha[i / 4] = Math.max(r, g, b) / 255.0;
        }
        return {
            data: alpha,
            width: img.width,
            height: img.height
        };
    }

    getWatermarkConfig(width, height, forceMode = 'auto') {
        let size;
        if (forceMode === '48') {
            size = 48;
        } else if (forceMode === '96') {
            size = 96;
        } else {
            // Gemini rules: 96x96 if both dimensions > 1024, else 48x48
            size = (width > 1024 && height > 1024) ? 96 : 48;
        }

        const margin = size === 96 ? 64 : 32;
        return {
            size: size,
            margin: margin,
            x: width - margin - size,
            y: height - margin - size
        };
    }

    process(imageData, forceMode = 'auto', logoValue = 255) {
        const { width, height } = imageData;
        const config = this.getWatermarkConfig(width, height, forceMode);
        const alphaMap = config.size === 96 ? this.alphaMap96 : this.alphaMap48;

        if (!alphaMap) return imageData;

        const data = imageData.data;
        const mapSize = config.size;
        const ALPHA_THRESHOLD = 0.002;
        const MAX_ALPHA = 0.99;

        for (let row = 0; row < mapSize; row++) {
            for (let col = 0; col < mapSize; col++) {
                const imgX = config.x + col;
                const imgY = config.y + row;

                if (imgX < 0 || imgX >= width || imgY < 0 || imgY >= height) continue;

                const alpha = alphaMap.data[row * mapSize + col];
                if (alpha < ALPHA_THRESHOLD) continue;

                const safeAlpha = Math.min(alpha, MAX_ALPHA);
                const oneMinusAlpha = 1 - safeAlpha;
                const pixelIndex = (imgY * width + imgX) * 4;

                for (let c = 0; c < 3; c++) {
                    const watermarked = data[pixelIndex + c];
                    // Formula: original = (watermarked - alpha * logo) / (1 - alpha)
                    const original = (watermarked - safeAlpha * logoValue) / oneMinusAlpha;
                    data[pixelIndex + c] = Math.max(0, Math.min(255, Math.round(original)));
                }
            }
        }
        return imageData;
    }
}

// UI Controller
const UI = {
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    uploadSection: document.getElementById('upload-section'),
    processSection: document.getElementById('process-section'),
    fileList: document.getElementById('file-list'),
    sizeMode: document.getElementById('size-mode'),
    processAllBtn: document.getElementById('process-all'),
    resetBtn: document.getElementById('reset-btn'),
    previewSection: document.getElementById('preview-section'),
    closeModal: document.querySelector('.close-modal'),
    imgBefore: document.getElementById('img-before'),
    imgAfter: document.getElementById('img-after'),
    comparison: document.getElementById('comparison-container'),
    afterOverlay: document.querySelector('.comparison-slider .after'),
    sliderHandle: document.querySelector('.slider-handle'),
    downloadBtn: document.getElementById('download-btn'),

    files: [],
    processor: new WatermarkProcessor(),

    init() {
        this.dropZone.onclick = () => this.fileInput.click();
        this.fileInput.onchange = (e) => this.handleFiles(e.target.files);
        
        window.addEventListener('dragover', (e) => { e.preventDefault(); this.dropZone.classList.add('dragover'); });
        window.addEventListener('dragleave', (e) => { e.preventDefault(); this.dropZone.classList.remove('dragover'); });
        window.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dropZone.classList.remove('dragover');
            this.handleFiles(e.dataTransfer.files);
        });

        this.processAllBtn.onclick = () => this.processAll();
        this.resetBtn.onclick = () => this.reset();
        this.closeModal.onclick = () => this.previewSection.classList.add('hidden');
        
        // Slider interaction
        let isDragging = false;
        const moveSlider = (e) => {
            if (!isDragging) return;
            const rect = this.comparison.getBoundingClientRect();
            let x = (e.pageX || e.touches[0].pageX) - rect.left;
            x = Math.max(0, Math.min(x, rect.width));
            const percent = (x / rect.width) * 100;
            this.afterOverlay.style.width = percent + '%';
            this.sliderHandle.style.left = percent + '%';
        };

        this.sliderHandle.onmousedown = () => isDragging = true;
        this.sliderHandle.ontouchstart = () => isDragging = true;
        window.onmouseup = () => isDragging = false;
        window.ontouchend = () => isDragging = false;
        window.onmousemove = moveSlider;
        window.ontouchmove = moveSlider;
    },

    handleFiles(fileList) {
        if (fileList.length === 0) return;
        
        this.files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
        this.renderFileList();
        this.uploadSection.classList.add('hidden');
        this.processSection.classList.remove('hidden');
    },

    renderFileList() {
        this.fileList.innerHTML = '';
        this.files.forEach((file, index) => {
            const item = document.createElement('div');
            item.className = 'file-item';
            const url = URL.createObjectURL(file);
            item.innerHTML = `
                <img src="${url}" alt="${file.name}">
                <div class="status-badge status-pending">等待中</div>
                <div class="file-info">${file.name}</div>
            `;
            item.onclick = () => this.showPreview(index);
            this.fileList.appendChild(item);
        });
    },

    async processAll() {
        if (!this.processor.isReady) {
            alert('浮水印資源載入中，請稍候...');
            return;
        }

        this.processAllBtn.disabled = true;
        this.processAllBtn.innerText = '處理中...';

        for (let i = 0; i < this.files.length; i++) {
            await this.processImage(i);
        }

        this.processAllBtn.disabled = false;
        this.processAllBtn.innerText = '處理所有圖片';
    },

    async processImage(index) {
        const file = this.files[index];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.src = URL.createObjectURL(file);
        
        await new Promise(resolve => img.onload = resolve);
        
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const processed = this.processor.process(imageData, this.sizeMode.value);
        
        ctx.putImageData(processed, 0, 0);
        
        this.files[index].processedUrl = canvas.toDataURL('image/png');
        this.files[index].originalUrl = img.src;
        
        const badges = this.fileList.querySelectorAll('.status-badge');
        badges[index].className = 'status-badge status-done';
        badges[index].innerText = '完成';
    },

    showPreview(index) {
        const file = this.files[index];
        if (!file.processedUrl) {
            // If not processed, process it now
            this.processImage(index).then(() => this.showPreview(index));
            return;
        }

        this.imgBefore.src = file.originalUrl;
        this.imgAfter.src = file.processedUrl;
        
        // Match comparison image sizes for slider
        this.imgAfter.onload = () => {
            const rect = this.imgBefore.getBoundingClientRect();
            this.imgAfter.style.width = rect.width + 'px';
            this.imgAfter.style.height = rect.height + 'px';
        };

        this.downloadBtn.href = file.processedUrl;
        this.downloadBtn.download = `processed_${file.name.split('.')[0]}.png`;
        this.previewSection.classList.remove('hidden');
        
        // Reset slider
        this.afterOverlay.style.width = '50%';
        this.sliderHandle.style.left = '50%';
    },

    reset() {
        this.files = [];
        this.fileInput.value = '';
        this.uploadSection.classList.remove('hidden');
        this.processSection.classList.add('hidden');
    }
};

UI.init();

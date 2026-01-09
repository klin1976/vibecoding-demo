import React, { useState, useEffect, useRef, useCallback } from 'react';
import './styles.css';
import { WatermarkEngine, WATERMARK_SIZE } from './lib/watermark';

const BG_SMALL_URL = '/bg_48.png';
const BG_LARGE_URL = '/bg_96.png';

function App() {
  const [engine, setEngine] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [images, setImages] = useState([]); // Array of image objects
  const [isDragging, setIsDragging] = useState(false);
  const [customLogo, setCustomLogo] = useState(null);
  const [logoOpacity, setLogoOpacity] = useState(29);
  const [logoSize, setLogoSize] = useState(200);
  const fileInputRef = useRef(null);
  const logoInputRef = useRef(null);

  useEffect(() => {
    const initEngine = async () => {
      const we = new WatermarkEngine();
      try {
        await we.init(BG_SMALL_URL, BG_LARGE_URL);
        setEngine(we);
        setIsReady(true);
      } catch (err) {
        console.error("Failed to load watermark resources", err);
      }
    };
    initEngine();
  }, []);

  // Load logo image for overlay
  const loadLogoImage = useCallback(() => {
    return new Promise((resolve) => {
      if (!customLogo) {
        resolve(null);
        return;
      }
      const logoImg = new Image();
      logoImg.crossOrigin = 'anonymous';
      logoImg.onload = () => resolve(logoImg);
      logoImg.onerror = () => resolve(null);
      // Check if already complete (cached)
      if (logoImg.complete && logoImg.src) {
        resolve(logoImg);
      } else {
        logoImg.src = customLogo;
      }
    });
  }, [customLogo]);

  // Load an image and return a promise
  const loadImage = (url) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
      // Handle already cached images
      if (img.complete) {
        resolve(img);
      }
    });
  };

  const processImage = useCallback(async (imageObj) => {
    if (!engine || !isReady) return imageObj;

    try {
      // Load both images in parallel - this avoids the race condition
      const [img, logoImg] = await Promise.all([
        loadImage(imageObj.originalUrl),
        loadLogoImage()
      ]);

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const forceSize = imageObj.sizeMode === 'auto'
        ? null
        : (imageObj.sizeMode === 'small' ? WATERMARK_SIZE.SMALL : WATERMARK_SIZE.LARGE);
      engine.process(canvas, forceSize, imageObj.intensity);

      // Add custom logo overlay if exists
      if (logoImg) {
        const opacity = logoOpacity / 100;
        const scale = logoSize / 100;
        const logoWidth = logoImg.width * scale;
        const logoHeight = logoImg.height * scale;

        // Position: bottom-right corner with margin
        const margin = 20;
        const x = canvas.width - logoWidth - margin;
        const y = canvas.height - logoHeight - margin;

        ctx.globalAlpha = opacity;
        ctx.drawImage(logoImg, x, y, logoWidth, logoHeight);
        ctx.globalAlpha = 1.0;
      }

      const outputUrl = canvas.toDataURL('image/png');
      return { ...imageObj, processedUrl: outputUrl, processing: false };
    } catch (e) {
      console.error('Image processing error:', e);
      return { ...imageObj, processing: false };
    }
  }, [engine, isReady, loadLogoImage, logoOpacity, logoSize]);

  const handleFiles = useCallback(async (files) => {
    const newImages = Array.from(files)
      .filter(f => f.type.startsWith('image/'))
      .map((file, idx) => ({
        id: Date.now() + idx,
        file,
        name: file.name,
        originalUrl: URL.createObjectURL(file),
        processedUrl: null,
        sizeMode: 'auto',
        intensity: 1.0,
        processing: true
      }));

    setImages(prev => [...prev, ...newImages]);

    // Process each image
    for (const img of newImages) {
      const processed = await processImage(img);
      setImages(prev => prev.map(i => i.id === img.id ? processed : i));
    }
  }, [processImage]);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleInputChange = (e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  };

  const handleLogoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setCustomLogo(URL.createObjectURL(file));
    }
  };

  const clearLogo = () => {
    setCustomLogo(null);
  };

  // Use ref to track images for reprocessing to avoid stale closure
  const imagesRef = useRef([]);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  // Reprocess all images when logo settings change
  const reprocessAllImages = useCallback(async () => {
    const currentImages = imagesRef.current;
    if (currentImages.length === 0) return;

    // Mark all as processing
    setImages(prev => prev.map(img => ({ ...img, processing: true })));

    // Reprocess each image
    for (const img of currentImages) {
      const processed = await processImage(img);
      setImages(prev => prev.map(i => i.id === img.id ? processed : i));
    }
  }, [processImage]);

  // Debounce timer for slider changes
  const reprocessTimerRef = useRef(null);

  // Trigger reprocess when logo settings change (debounced for sliders)
  useEffect(() => {
    if (imagesRef.current.length === 0) return;

    // Clear existing timer
    if (reprocessTimerRef.current) {
      clearTimeout(reprocessTimerRef.current);
    }

    // Debounce reprocessing by 300ms for slider changes
    reprocessTimerRef.current = setTimeout(() => {
      reprocessAllImages();
    }, 300);

    return () => {
      if (reprocessTimerRef.current) {
        clearTimeout(reprocessTimerRef.current);
      }
    };
  }, [customLogo, logoOpacity, logoSize, reprocessAllImages]);

  // Convert data URL to Blob for proper download handling
  const dataURLtoBlob = (dataURL) => {
    const arr = dataURL.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  };

  const updateImageSetting = async (id, key, value) => {
    setImages(prev => prev.map(img =>
      img.id === id ? { ...img, [key]: value, processing: true } : img
    ));

    const targetImg = images.find(img => img.id === id);
    if (targetImg) {
      const updated = { ...targetImg, [key]: value };
      const processed = await processImage(updated);
      setImages(prev => prev.map(i => i.id === id ? processed : i));
    }
  };

  const removeImage = (id) => {
    setImages(prev => prev.filter(img => img.id !== id));
  };

  // Manual Save Mode relying on user interaction
  // This bypasses the managed explorer renaming issues
  const [saveModalImg, setSaveModalImg] = useState(null);

  const openSaveModal = (img) => {
    setSaveModalImg(img);
  };

  const closeSaveModal = () => {
    setSaveModalImg(null);
  };

  // Old download function removed to prevent confusion
  const downloadImage = (img) => {
    openSaveModal(img);
  };

  const downloadAll = () => {
    images.forEach((img, index) => {
      // Stagger downloads to avoid browser blocking
      setTimeout(() => {
        downloadImage(img);
      }, index * 500);
    });
  };

  // Preview image in a new window
  const previewImage = (img) => {
    const url = img.processedUrl || img.originalUrl;
    if (!url) return;

    try {
      // Convert data URL to Blob for preview
      if (url.startsWith('data:')) {
        const blob = dataURLtoBlob(url);
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank');
      } else {
        window.open(url, '_blank');
      }
    } catch (error) {
      console.error('Preview failed:', error);
      // Fallback: create an image in new tab
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(`<html><head><title>Preview</title></head><body style="margin:0;background:#000;display:flex;justify-content:center;align-items:center;min-height:100vh;"><img src="${url}" style="max-width:100%;max-height:100vh;"/></body></html>`);
      }
    }
  };

  return (
    <div className="app">
      {/* Header Title */}
      <header className="header">
        <h1 className="main-title">
          <span className="title-gemini">Gemini</span>
          <span className="title-text">浮水印去除器</span>
        </h1>
        {images.length > 0 && (
          <button className="download-all-btn" onClick={downloadAll}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 4v12M8 12l4 4 4-4M4 18h16" />
            </svg>
            全部下載
          </button>
        )}
      </header>

      <main className="main-content">
        {/* Custom Logo Section */}
        <section className="logo-section">
          <div className="logo-header">
            <span className="logo-indicator"></span>
            <span className="logo-title">自訂 Logo（選填）</span>
            {customLogo && (
              <button className="clear-logo-btn" onClick={clearLogo}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
                清除 Logo
              </button>
            )}
          </div>

          <div className="logo-controls">
            <div
              className="logo-preview"
              onClick={() => logoInputRef.current?.click()}
            >
              {customLogo ? (
                <img src={customLogo} alt="Custom Logo" />
              ) : (
                <div className="logo-placeholder">+</div>
              )}
              <input
                type="file"
                ref={logoInputRef}
                onChange={handleLogoChange}
                accept="image/*"
                hidden
              />
            </div>

            <div className="logo-sliders">
              <div className="slider-group">
                <label>透明度:</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={logoOpacity}
                  onChange={(e) => setLogoOpacity(e.target.value)}
                />
                <span>{logoOpacity}%</span>
              </div>
              <div className="slider-group">
                <label>大小:</label>
                <input
                  type="range"
                  min="50"
                  max="400"
                  value={logoSize}
                  onChange={(e) => setLogoSize(e.target.value)}
                />
                <span>{logoSize}%</span>
              </div>
            </div>
          </div>
        </section>

        {/* Upload / Image Grid Area */}
        <section
          className={`image-grid-container ${isDragging ? 'dragging' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => images.length === 0 && fileInputRef.current?.click()}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleInputChange}
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
          />

          {images.length === 0 ? (
            <div className="empty-state">
              <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12M8 8l4-4 4 4" />
              </svg>
              <p>拖放圖片至此或點擊上傳</p>
              <span>支援 PNG, JPG, WebP 格式</span>
            </div>
          ) : (
            <div className="image-grid">
              {images.map(img => (
                <div key={img.id} className="image-card">
                  <div className="card-preview">
                    {img.processing ? (
                      <div className="card-loading">
                        <div className="spinner"></div>
                      </div>
                    ) : (
                      <img src={img.processedUrl || img.originalUrl} alt={img.name} />
                    )}
                  </div>

                  <div className="card-controls">
                    <select
                      value={img.sizeMode}
                      onChange={(e) => updateImageSetting(img.id, 'sizeMode', e.target.value)}
                    >
                      <option value="auto">自動偵測大小</option>
                      <option value="small">小 (48×48)</option>
                      <option value="large">大 (96×96)</option>
                    </select>

                    <div className="intensity-slider">
                      <label>強度調整: {img.intensity.toFixed(1)}</label>
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.1"
                        value={img.intensity}
                        onChange={(e) => updateImageSetting(img.id, 'intensity', parseFloat(e.target.value))}
                      />
                    </div>

                    <div className="card-actions">
                      <button className="action-btn" onClick={() => previewImage(img)} title="預覽">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="3"></circle>
                          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"></path>
                        </svg>
                      </button>
                      <button className="action-btn delete" onClick={() => removeImage(img.id)} title="刪除">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                      {/* Download link (visible) */}
                      {/* Download button (triggers modal) */}
                      <button
                        className="action-btn download"
                        onClick={() => downloadImage(img)}
                        title="下載"
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 4v12M8 12l4 4 4-4M4 18h16" />
                        </svg>
                        下載
                      </button>
                    </div>
                  </div>

                  <div className="card-filename">{img.name}</div>
                </div>
              ))}

              {/* Add more button */}
              <div
                className="add-more-card"
                onClick={() => fileInputRef.current?.click()}
              >
                <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                <span>新增圖片</span>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Save Modal */}
      {saveModalImg && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.85)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem'
          }}
          onClick={closeSaveModal}
        >
          <div
            style={{
              background: '#1a1b1e',
              padding: '2rem',
              borderRadius: '12px',
              maxWidth: '90%',
              maxHeight: '90%',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              alignItems: 'center',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              border: '1px solid #373a40'
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: 0, color: '#fff', fontSize: '1.5rem' }}>手動儲存圖片</h3>
            <p style={{ color: '#adb5bd', textAlign: 'center', margin: 0 }}>
              您的瀏覽器安全性設定限制了自動下載檔名。<br />
              <span style={{ color: '#4dabf7', fontWeight: 'bold' }}>請在下方圖片按右鍵 &gt; 另存圖片為...</span>
            </p>

            <img
              src={saveModalImg.processedUrl || saveModalImg.originalUrl}
              alt="Result"
              style={{
                maxWidth: '100%',
                maxHeight: '60vh',
                objectFit: 'contain',
                background: '#000',
                border: '1px solid #333'
              }}
            />

            <div style={{ display: 'flex', gap: '1rem', width: '100%', flexDirection: 'column' }}>
              <div style={{ display: 'flex', gap: '1rem', width: '100%' }}>
                <input
                  type="text"
                  readOnly
                  value={`processed_${saveModalImg.name.replace(/\.[^/.]+$/, '')}.png`}
                  style={{
                    flex: 1,
                    background: '#25262b',
                    border: '1px solid #373a40',
                    color: '#C1C2C5',
                    padding: '0.5rem',
                    borderRadius: '4px',
                    fontSize: '0.9rem'
                  }}
                  onClick={e => e.target.select()}
                  title="建議檔名 (可複製)"
                />
                <button
                  onClick={closeSaveModal}
                  className="action-btn"
                  style={{ width: 'auto', padding: '0 1.5rem', background: '#373a40' }}
                >
                  關閉
                </button>
              </div>

              {/* Copy to Clipboard Button - The User's "Life Saver" */}
              <button
                className="action-btn"
                style={{
                  width: '100%',
                  background: '#228be6',
                  justifyContent: 'center',
                  padding: '0.75rem',
                  fontSize: '1rem'
                }}
                onClick={async () => {
                  try {
                    const url = saveModalImg.processedUrl || saveModalImg.originalUrl;
                    const response = await fetch(url);
                    const blob = await response.blob();
                    await navigator.clipboard.write([
                      new ClipboardItem({
                        [blob.type]: blob
                      })
                    ]);
                    alert('圖片已複製！請直接貼上到 Word 或其他程式中。');
                  } catch (err) {
                    console.error('Copy failed', err);
                    alert('複製失敗，請確認瀏覽器權限。');
                  }
                }}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}>
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                複製圖片到剪貼簿 (推薦)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

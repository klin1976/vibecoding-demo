const MAX_ALPHA = 0.99; // Avoid division by near-zero
const ALPHA_THRESHOLD = 0.002; // Ignore very small alpha (noise)

export const WATERMARK_SIZE = {
    SMALL: 'small',
    LARGE: 'large'
};

export class WatermarkEngine {
    constructor() {
        this.alphaMaps = {
            small: null,
            large: null
        };
        this.ready = false;
        // C++ version uses 255.0 as logo value (white)
        this.logoValue = 255.0;
    }

    async init(bgSmallUrl, bgLargeUrl) {
        try {
            const [smallImg, largeImg] = await Promise.all([
                this.loadImage(bgSmallUrl),
                this.loadImage(bgLargeUrl)
            ]);

            this.alphaMaps.small = this.calculateAlphaMap(smallImg);
            this.alphaMaps.large = this.calculateAlphaMap(largeImg);
            this.ready = true;
            console.log('[log] Watermark Engine Initialized');
        } catch (e) {
            console.error("Failed to initialize watermark engine:", e);
            throw e;
        }
    }

    loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });
    }

    // Calculate alpha map from background capture (bg_48.png / bg_96.png)
    calculateAlphaMap(img) {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const data = imageData.data;
        const alphaMap = new Float32Array(img.width * img.height);

        for (let i = 0; i < data.length; i += 4) {
            // In C++: alpha = max(R, G, B) / 255.0
            // This represents how "white" the pixel is, which is the opacity of the logo
            const maxVal = Math.max(data[i], data[i + 1], data[i + 2]);
            alphaMap[i / 4] = maxVal / 255.0;
        }

        return {
            width: img.width,
            height: img.height,
            data: alphaMap
        };
    }

    process(canvas, forceSize = null, intensity = 1.0) {
        if (!this.ready) throw new Error("Watermark engine not initialized");

        const width = canvas.width;
        const height = canvas.height;

        // Determine watermark size
        let config;
        if (forceSize) {
            config = forceSize === WATERMARK_SIZE.LARGE ?
                this.getWatermarkConfigLarge() :
                this.getWatermarkConfigSmall();
        } else {
            config = this.getWatermarkConfig(width, height);
        }

        const alphaMap = config.size === 96 ? this.alphaMaps.large : this.alphaMaps.small;

        // Calculate ROI (Region of Interest)
        const roiX = width - config.margin_right - config.logo_size;
        const roiY = height - config.margin_bottom - config.logo_size;

        if (roiX < 0 || roiY < 0) return; // Image too small

        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(roiX, roiY, config.logo_size, config.logo_size);
        const data = imageData.data;

        // Apply Reverse Alpha Blending with intensity scaling
        // Original = (Watermarked - Alpha * Logo) / (1 - Alpha)
        for (let i = 0; i < alphaMap.data.length; i++) {
            // Scale alpha by intensity (allows user adjustment)
            const rawAlpha = alphaMap.data[i] * intensity;
            const alpha = Math.min(rawAlpha, MAX_ALPHA); // Clamp alpha

            if (alpha < ALPHA_THRESHOLD) continue;

            const alphaM = alpha * this.logoValue;
            const oneMinusAlpha = 1.0 - alpha;

            const idx = i * 4;

            // R
            const r = (data[idx] - alphaM) / oneMinusAlpha;
            data[idx] = Math.max(0, Math.min(255, r));

            // G
            const g = (data[idx + 1] - alphaM) / oneMinusAlpha;
            data[idx + 1] = Math.max(0, Math.min(255, g));

            // B
            const b = (data[idx + 2] - alphaM) / oneMinusAlpha;
            data[idx + 2] = Math.max(0, Math.min(255, b));

            // Alpha channel remains unchanged (usually 255)
        }

        ctx.putImageData(imageData, roiX, roiY);
    }

    getWatermarkConfig(width, height) {
        // Large (96x96, 64px margin): BOTH width AND height > 1024
        if (width > 1024 && height > 1024) {
            return this.getWatermarkConfigLarge();
        } else {
            return this.getWatermarkConfigSmall();
        }
    }

    getWatermarkConfigLarge() {
        return {
            margin_right: 64,
            margin_bottom: 64,
            logo_size: 96,
            size: 96
        };
    }

    getWatermarkConfigSmall() {
        return {
            margin_right: 32,
            margin_bottom: 32,
            logo_size: 48,
            size: 48
        };
    }
}

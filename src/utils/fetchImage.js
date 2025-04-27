/**
 * Fetches an image and converts it to a data URL
 * @param {string} src - URL of the image
 * @param {number} [timeout=3000] - Milliseconds before timing out
 * @returns {Promise<string>} Promise that resolves to the data URL
 */
export function fetchImageAsDataURL(src, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Image load timed out'));
    }, timeout);
    
    const image = new Image();
    image.crossOrigin = 'anonymous';
    
    image.onload = async () => {
      clearTimeout(timeoutId);
      try {
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        try {
          const dataURL = canvas.toDataURL('image/png');
          resolve(dataURL);
        } catch (e) {
          // Handle tainted canvas due to CORS issues
          reject(new Error('CORS restrictions prevented image capture'));
        }
      } catch (e) {
        reject(e);
      }
    };
    
    image.onerror = (e) => {
      clearTimeout(timeoutId);
      reject(new Error('Failed to load image: ' + (e.message || 'Unknown error')));
    };
    
    image.src = src;
  });
}

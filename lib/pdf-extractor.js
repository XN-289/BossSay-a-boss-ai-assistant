/**
 * BossSay - PDF 文本提取器 v4
 * 使用 pdf.js (PDFDocumentProxy) 提取文本，支持 CID 字体/中文
 * 如果 pdf.js 不可用，回退到简易策略
 */
const PDFExtractor = {
  async extractText(arrayBuffer) {
    // 优先使用 pdf.js
    if (typeof pdfjsLib !== 'undefined') {
      try {
        const text = await this._extractWithPdfJs(arrayBuffer);
        if (text && text.trim().length > 10) return text;
      } catch (e) {
        console.warn('[BossSay] pdf.js 提取失败，回退到简易模式:', e);
      }
    }

    // 回退：简易提取
    return this._extractSimple(arrayBuffer);
  },

  /**
   * 使用 pdf.js 提取文本（正确处理 CID 字体和 CMap）
   */
  async _extractWithPdfJs(arrayBuffer) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');

    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const totalPages = pdf.numPages;
    const textParts = [];

    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();

      // 按 y 坐标分组，同行的文本拼在一起
      const items = textContent.items.filter(item => item.str.trim());
      if (items.length === 0) continue;

      let currentLine = '';
      let lastY = null;

      for (const item of items) {
        const y = Math.round(item.transform[5]);
        if (lastY !== null && Math.abs(y - lastY) > 3) {
          // 换行
          textParts.push(currentLine);
          currentLine = '';
        }
        currentLine += item.str;
        lastY = y;
      }
      if (currentLine) textParts.push(currentLine);
    }

    return textParts.join('\n');
  },

  /**
   * 回退：简易文本提取
   */
  async _extractSimple(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const results = [];

    // 策略1: BT...ET 文本块
    const strategy1 = this._extractFromTextBlocks(bytes);
    if (strategy1) results.push(strategy1);

    // 策略2: 压缩 Stream 中提取
    const strategy2 = await this._extractFromCompressedStreams(bytes);
    if (strategy2) results.push(strategy2);

    // 策略3: 可打印字符串
    const strategy3 = this._extractPrintableStrings(bytes);
    if (strategy3 && strategy3.length > (strategy1?.length || 0)) {
      results.push(strategy3);
    }

    const best = results.sort((a, b) => b.length - a.length)[0] || '';
    return this._cleanText(best);
  },

  _extractFromTextBlocks(bytes) {
    const text = this._bytesToString(bytes);
    const results = [];
    const regex = /BT[\s\r\n]([\s\S]*?)ET/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const block = match[1];
      let extracted = '';
      const tjRegex = /\(([^)]*)\)/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        extracted += tjMatch[1];
      }
      const tjArrRegex = /\[((?:\([^)]*\)\s*)*)\]/g;
      let tjArrMatch;
      while ((tjArrMatch = tjArrRegex.exec(block)) !== null) {
        const inner = tjArrMatch[1];
        const sRegex = /\(([^)]*)\)/g;
        let sMatch;
        while ((sMatch = sRegex.exec(inner)) !== null) {
          extracted += sMatch[1];
        }
      }
      if (extracted.length > 5) results.push(extracted);
    }
    return results.join('\n');
  },

  async _extractFromCompressedStreams(bytes) {
    const results = [];
    const streamMarker = [0x73, 0x74, 0x72, 0x65, 0x61, 0x6D];
    const endMarker = [0x65, 0x6E, 0x64, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6D];
    let searchStart = 0;

    while (searchStart < bytes.length - 20) {
      const streamPos = this._indexOf(bytes, streamMarker, searchStart);
      if (streamPos === -1) break;
      let dataStart = streamPos + 6;
      if (dataStart < bytes.length && bytes[dataStart] === 0x0D) dataStart++;
      if (dataStart < bytes.length && bytes[dataStart] === 0x0A) dataStart++;
      const endPos = this._indexOf(bytes, endMarker, dataStart);
      if (endPos === -1) break;
      const streamData = bytes.slice(dataStart, endPos);

      if (streamData.length > 0) {
        try {
          let decompressed;
          if (streamData[0] === 0x78) {
            decompressed = await this._inflateZlib(streamData);
          } else {
            decompressed = streamData;
          }
          if (decompressed && decompressed.length > 0) {
            const text = this._bytesToString(decompressed);
            const extracted = this._extractTextFromDecompressed(text);
            if (extracted) results.push(extracted);
          }
        } catch (e) {
          try {
            const text = this._bytesToString(streamData);
            const extracted = this._extractTextFromDecompressed(text);
            if (extracted) results.push(extracted);
          } catch (e2) {}
        }
      }
      searchStart = endPos + 9;
    }
    return results.join('\n');
  },

  _extractPrintableStrings(bytes) {
    const results = [];
    let current = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b >= 32 && b < 127) {
        current += String.fromCharCode(b);
      } else {
        if (current.length >= 6) {
          if (/[a-zA-Z一-鿿]{3,}/.test(current)) results.push(current);
        }
        current = '';
      }
    }
    if (current.length >= 6 && /[a-zA-Z一-鿿]{3,}/.test(current)) results.push(current);
    return results.join('\n');
  },

  _extractTextFromDecompressed(text) {
    const results = [];
    const btEtRegex = /BT[\s\r\n]([\s\S]*?)ET/g;
    let match;
    while ((match = btEtRegex.exec(text)) !== null) {
      const block = match[1];
      let extracted = '';
      const tjRegex = /\(([^)]*)\)/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        extracted += tjMatch[1];
      }
      const tjArrRegex = /\[((?:\([^)]*\)\s*)*)\]/g;
      let tjArrMatch;
      while ((tjArrMatch = tjArrRegex.exec(block)) !== null) {
        const inner = tjArrMatch[1];
        const sRegex = /\(([^)]*)\)/g;
        let sMatch;
        while ((sMatch = sRegex.exec(inner)) !== null) {
          extracted += sMatch[1];
        }
      }
      if (extracted.length > 3) results.push(extracted);
    }
    if (results.length === 0) {
      const strRegex = /\(([^)]{3,})\)/g;
      while ((match = strRegex.exec(text)) !== null) {
        const str = match[1];
        if (/[a-zA-Z一-鿿]/.test(str)) results.push(str);
      }
    }
    return results.join('\n');
  },

  async _inflateZlib(data) {
    // PDF FlateDecode 使用 zlib 格式 (2字节头 + raw deflate)
    // DecompressionStream('deflate') 只接受 raw deflate，需要跳过 zlib 头
    let compressedData = data;
    // 检查 zlib 头: 0x78 (CMF) 后跟 0x01/0x5E/0x9C/0xDA (FLG)
    if (data.length > 2 && data[0] === 0x78) {
      compressedData = data.slice(2); // 跳过 zlib 头
    }
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    writer.write(compressedData);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  },

  _indexOf(arr, pattern, start = 0) {
    const patLen = pattern.length;
    for (let i = start; i <= arr.length - patLen; i++) {
      let found = true;
      for (let j = 0; j < patLen; j++) {
        if (arr[i + j] !== pattern[j]) { found = false; break; }
      }
      if (found) return i;
    }
    return -1;
  },

  _bytesToString(bytes) {
    const chunkSize = 16384;
    let result = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      result += String.fromCharCode.apply(null, chunk);
    }
    return result;
  },

  _cleanText(text) {
    if (!text) return '';
    return text
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  },

  /**
   * 将 PDF 每一页渲染为图片（用于扫描件/图片 PDF 的 OCR）
   * @returns {Promise<Array<{dataUrl: string, width: number, height: number}>>}
   */
  async renderPagesAsImages(arrayBuffer, maxPages = 10) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('pdf.js 未加载，无法渲染 PDF 页面');
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];
    const numPages = Math.min(pdf.numPages, maxPages);

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      // 2 倍缩放，平衡清晰度和大小
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      pages.push({
        dataUrl: canvas.toDataURL('image/jpeg', 0.8),
        width: viewport.width,
        height: viewport.height,
      });
    }
    return pages;
  }
};

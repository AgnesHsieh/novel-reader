/**
 * Bookshelf & Reading Progress Storage Manager
 * Uses LocalStorage and IndexedDB for persistent novel reading state
 */

class NovelDB {
  constructor() {
    this.STORAGE_SHELF_KEY = 'weread_bookshelf_v1';
    this.STORAGE_PROGRESS_KEY = 'weread_progress_v1';
    this.STORAGE_SETTINGS_KEY = 'weread_settings_v1';
    this.STORAGE_STATS_KEY = 'weread_reading_stats_v1';

    this.dbPromise = this.initIndexedDB();
    this.initDefaultBookshelf();
  }

  // Initialize IndexedDB for large chapter caches (PDF / large TXT novels)
  initIndexedDB() {
    return new Promise((resolve) => {
      if (!window.indexedDB) return resolve(null);
      try {
        const req = indexedDB.open('WeReadNovelDB', 2);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('chapters')) {
            db.createObjectStore('chapters', { keyPath: 'bookId' });
          }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
  }

  // Pre-seed bookshelf with classic gems if empty on first run
  initDefaultBookshelf() {
    const shelf = this.getBookshelf();
    if (!shelf || shelf.length === 0) {
      const initialBooks = [
        {
          id: 'novel_gmzz',
          title: '詭秘之主',
          author: '愛潛水的烏賊',
          category: '玄幻奇幻',
          rating: 9.8,
          coverBg: 'linear-gradient(135deg, #1f2937, #111827)',
          coverTag: '神作',
          addedAt: Date.now() - 86400000 * 2,
          lastReadAt: Date.now() - 3600000 * 3,
          progress: {
            chapterIndex: 0,
            chapterTitle: '第一章 緋紅',
            scrollPercent: 18,
            totalChapters: 3
          }
        },
        {
          id: 'novel_qy',
          title: '慶餘年',
          author: '貓膩',
          category: '歷史傳奇',
          rating: 9.7,
          coverBg: 'linear-gradient(135deg, #1e3a8a, #0f172a)',
          coverTag: '力薦',
          addedAt: Date.now() - 86400000 * 5,
          lastReadAt: Date.now() - 86400000 * 1,
          progress: {
            chapterIndex: 0,
            chapterTitle: '第一章 澹州的海風',
            scrollPercent: 42,
            totalChapters: 2
          }
        },
        {
          id: 'novel_sgyy',
          title: '三國演義',
          author: '羅貫中',
          category: '古典名著',
          rating: 9.9,
          coverBg: 'linear-gradient(135deg, #78350f, #451a03)',
          coverTag: '傳世',
          addedAt: Date.now() - 86400000 * 7,
          lastReadAt: Date.now() - 86400000 * 2,
          progress: {
            chapterIndex: 0,
            chapterTitle: '第一回 宴桃園豪傑三結義',
            scrollPercent: 0,
            totalChapters: 2
          }
        }
      ];
      this.saveBookshelf(initialBooks);
    }
  }

  // Get Bookshelf
  getBookshelf() {
    try {
      const raw = localStorage.getItem(this.STORAGE_SHELF_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('Failed to read bookshelf:', e);
      return [];
    }
  }

  // Save Bookshelf
  saveBookshelf(books) {
    try {
      localStorage.setItem(this.STORAGE_SHELF_KEY, JSON.stringify(books));
    } catch (e) {
      console.error('Failed to save bookshelf:', e);
    }
  }

  // Add book to shelf
  addToShelf(book) {
    const shelf = this.getBookshelf();
    const existingIndex = shelf.findIndex(b => b.id === book.id);
    const bookEntry = {
      id: book.id,
      title: book.title,
      author: book.author || '佚名',
      category: book.category || '網絡小說',
      cover: book.cover || null,
      coverBg: book.coverBg || 'linear-gradient(135deg, #374151, #1f2937)',
      coverTag: book.coverTag || null,
      detailUrl: book.detailUrl || null,
      addedAt: Date.now(),
      lastReadAt: Date.now(),
      progress: this.getProgress(book.id) || {
        chapterIndex: book.initialIndex || 0,
        chapterTitle: (book.chapters && book.chapters[book.initialIndex || 0] ? book.chapters[book.initialIndex || 0].title : '未開始閱讀'),
        scrollPercent: 0,
        totalChapters: (book.chapters ? book.chapters.length : 1)
      }
    };

    // If book has valid chapters, save in local memory/IndexedDB
    if (Array.isArray(book.chapters) && book.chapters.length > 0) {
      this.saveChapters(book.id, book.chapters);
    }

    if (existingIndex >= 0) {
      shelf[existingIndex] = { ...shelf[existingIndex], ...bookEntry };
    } else {
      shelf.unshift(bookEntry);
    }

    this.saveBookshelf(shelf);
    return bookEntry;
  }

  // Check if book is already in shelf
  isInShelf(bookId) {
    const shelf = this.getBookshelf();
    return shelf.some(b => b.id === bookId);
  }

  // Remove book from shelf
  removeFromShelf(bookId) {
    let shelf = this.getBookshelf();
    shelf = shelf.filter(b => b.id !== bookId);
    this.saveBookshelf(shelf);

    // Remove from localStorage
    try {
      localStorage.removeItem(`weread_book_chapters_${bookId}`);
    } catch (e) {}

    // Remove progress
    const progressMap = this.getAllProgress();
    delete progressMap[bookId];
    try {
      localStorage.setItem(this.STORAGE_PROGRESS_KEY, JSON.stringify(progressMap));
    } catch (e) {}

    // Remove from IndexedDB
    this.dbPromise.then(db => {
      if (db) {
        try {
          const tx = db.transaction('chapters', 'readwrite');
          tx.objectStore('chapters').delete(bookId);
        } catch (e) {}
      }
    });

    return true;
  }

  // Asynchronous save chapters to both IndexedDB (safe for large text/PDF) and localStorage
  async saveChapters(bookId, chapters) {
    if (!bookId || !Array.isArray(chapters) || chapters.length === 0) return;

    // Fast sync cache in localStorage (if quota permits)
    try {
      localStorage.setItem(`weread_book_chapters_${bookId}`, JSON.stringify(chapters));
    } catch (e) {
      // Quota exceeded for large novels/PDFs; IndexedDB will persist it
    }

    // Persist in IndexedDB
    try {
      const db = await this.dbPromise;
      if (db) {
        const tx = db.transaction('chapters', 'readwrite');
        tx.objectStore('chapters').put({ bookId, chapters, updatedAt: Date.now() });
      }
    } catch (err) {
      console.warn('IndexedDB save chapters failed:', err);
    }
  }

  // Asynchronous get chapters from localStorage or IndexedDB
  async getChapters(bookId) {
    // 1. Try localStorage
    const fast = this.getCachedChapters(bookId);
    if (fast && fast.length > 0) return fast;

    // 2. Try IndexedDB
    try {
      const db = await this.dbPromise;
      if (db) {
        return new Promise((resolve) => {
          const tx = db.transaction('chapters', 'readonly');
          const store = tx.objectStore('chapters');
          const req = store.get(bookId);
          req.onsuccess = () => {
            if (req.result && Array.isArray(req.result.chapters) && req.result.chapters.length > 0) {
              resolve(req.result.chapters);
            } else {
              resolve(null);
            }
          };
          req.onerror = () => resolve(null);
        });
      }
    } catch (e) {}

    return null;
  }

  // Save reading progress for a specific book
  saveProgress(bookId, { chapterIndex, chapterTitle, scrollPercent, totalChapters }) {
    const progressMap = this.getAllProgress();
    const progressData = {
      chapterIndex: chapterIndex || 0,
      chapterTitle: chapterTitle || '',
      scrollPercent: Math.min(100, Math.max(0, Math.round(scrollPercent || 0))),
      totalChapters: totalChapters || 1,
      updatedAt: Date.now()
    };

    progressMap[bookId] = progressData;

    try {
      localStorage.setItem(this.STORAGE_PROGRESS_KEY, JSON.stringify(progressMap));
    } catch (e) {
      console.error('Failed to save progress:', e);
    }

    // Also update bookshelf item's lastReadAt and progress
    const shelf = this.getBookshelf();
    const item = shelf.find(b => b.id === bookId);
    if (item) {
      item.progress = progressData;
      item.lastReadAt = Date.now();
      // Move to top of shelf
      const filtered = shelf.filter(b => b.id !== bookId);
      filtered.unshift(item);
      this.saveBookshelf(filtered);
    }
  }

  // Get reading progress for a book
  getProgress(bookId) {
    const map = this.getAllProgress();
    return map[bookId] || null;
  }

  getAllProgress() {
    try {
      const raw = localStorage.getItem(this.STORAGE_PROGRESS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  // Get Cached Chapters (for local or saved books)
  getCachedChapters(bookId) {
    try {
      const raw = localStorage.getItem(`weread_book_chapters_${bookId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return (Array.isArray(parsed) && parsed.length > 0) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  // User Settings (Theme, Font Size, Line Spacing, Font Family)
  getSettings() {
    const defaults = {
      theme: 'paper', // paper, white, mint, slate, oled
      fontSize: 18,   // 14 ~ 28
      lineHeight: 1.85, // 1.5, 1.85, 2.2
      fontFamily: 'system', // system, serif, kaiti
      turnMode: 'scroll', // scroll, page
      brightness: 100, // 30 ~ 100%
      chineseMode: 's2t' // 's2t' (預設自動將簡體轉繁體正體) 或 'origin' (原文)
    };

    try {
      const raw = localStorage.getItem(this.STORAGE_SETTINGS_KEY);
      return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
    } catch (e) {
      return defaults;
    }
  }

  saveSettings(settings) {
    try {
      localStorage.setItem(this.STORAGE_SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {}
  }

  // Reading Time Stats (WeChat Read style "本週已讀 X 小時 X 分鐘")
  recordReadingTime(seconds) {
    try {
      const raw = localStorage.getItem(this.STORAGE_STATS_KEY);
      const stats = raw ? JSON.parse(raw) : { totalSeconds: 12600, todaySeconds: 1800, lastDate: new Date().toDateString() };
      
      const today = new Date().toDateString();
      if (stats.lastDate !== today) {
        stats.todaySeconds = 0;
        stats.lastDate = today;
      }

      stats.totalSeconds = (stats.totalSeconds || 0) + seconds;
      stats.todaySeconds = (stats.todaySeconds || 0) + seconds;

      localStorage.setItem(this.STORAGE_STATS_KEY, JSON.stringify(stats));
      return stats;
    } catch (e) {
      return { totalSeconds: 12600, todaySeconds: 1800 };
    }
  }

  getReadingStats() {
    try {
      const raw = localStorage.getItem(this.STORAGE_STATS_KEY);
      return raw ? JSON.parse(raw) : { totalSeconds: 13500, todaySeconds: 2400 };
    } catch (e) {
      return { totalSeconds: 13500, todaySeconds: 2400 };
    }
  }
}

window.novelDB = new NovelDB();

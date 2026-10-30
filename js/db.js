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
    this.STORAGE_DELETED_KEY = 'weread_deleted_books_v1';
    this.STORAGE_INIT_KEY = 'weread_shelf_initialized_v1';

    this.dbPromise = this.initIndexedDB();
    this.initDefaultBookshelf();
  }

  // Initialize IndexedDB for large chapter caches (PDF / large TXT novels)
  initIndexedDB() {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.indexedDB) return resolve(null);
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

  // Tombstone management for book removals (prevents deleted books from being resurrected by sync)
  getDeletedBookIds() {
    try {
      const raw = localStorage.getItem(this.STORAGE_DELETED_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  markBookDeleted(bookId) {
    if (!bookId) return;
    try {
      const set = new Set(this.getDeletedBookIds());
      set.add(bookId);
      localStorage.setItem(this.STORAGE_DELETED_KEY, JSON.stringify(Array.from(set)));
    } catch (e) {}
  }

  unmarkBookDeleted(bookId) {
    if (!bookId) return;
    try {
      const set = new Set(this.getDeletedBookIds());
      set.delete(bookId);
      localStorage.setItem(this.STORAGE_DELETED_KEY, JSON.stringify(Array.from(set)));
    } catch (e) {}
  }

  // Pre-seed bookshelf with classic gems ONLY on brand new first-time installation
  initDefaultBookshelf() {
    try {
      if (localStorage.getItem(this.STORAGE_INIT_KEY)) {
        return; // User has already initialized, never force default books back
      }
    } catch (e) {}

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

    try {
      localStorage.setItem(this.STORAGE_INIT_KEY, 'true');
    } catch (e) {}
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
    this.unmarkBookDeleted(book.id);

    // Push updated shelf to local server hub immediately
    this.pushShelfToServer(shelf).catch(() => {});

    return bookEntry;
  }

  // Push shelf and tombstones to server hub asynchronously
  async pushShelfToServer(shelf) {
    try {
      const apiBase = (window.novelSources && typeof window.novelSources.getApiBaseUrl === 'function')
        ? window.novelSources.getApiBaseUrl()
        : '';
      const localProgress = this.getAllProgress();
      const localSettings = this.getSettings();
      const deletedIds = this.getDeletedBookIds();

      await fetch(`${apiBase}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shelf,
          progress: localProgress,
          settings: localSettings,
          deletedIds
        })
      });
    } catch (e) {}
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
    this.markBookDeleted(bookId);

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

    // Push updated shelf to local server hub immediately so server drops the book
    this.pushShelfToServer(shelf).catch(() => {});

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

    // Push chapters to server hub so mobile can download and read 100% offline
    this.pushChaptersToServer(bookId, chapters).catch(() => {});
  }

  // Push full chapters to server hub for seamless cross-device offline reading
  async pushChaptersToServer(bookId, chapters) {
    if (!bookId || !Array.isArray(chapters) || chapters.length === 0) return;
    try {
      const apiBase = (window.novelSources && typeof window.novelSources.getApiBaseUrl === 'function')
        ? window.novelSources.getApiBaseUrl()
        : '';
      await fetch(`${apiBase}/api/book-chapters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, chapters })
      });
    } catch (e) {}
  }

  // Asynchronous get chapters from localStorage, IndexedDB, or server hub fallback
  async getChapters(bookId) {
    // 1. Try localStorage
    const fast = this.getCachedChapters(bookId);
    if (fast && fast.length > 0) return fast;

    // 2. Try IndexedDB
    try {
      const db = await this.dbPromise;
      if (db) {
        const idbChapters = await new Promise((resolve) => {
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
        if (idbChapters && idbChapters.length > 0) return idbChapters;
      }
    } catch (e) {}

    // 3. Try fetching from server hub /api/book-chapters (syncs chapters from PC to mobile)
    try {
      const apiBase = (window.novelSources && typeof window.novelSources.getApiBaseUrl === 'function')
        ? window.novelSources.getApiBaseUrl()
        : '';
      const res = await fetch(`${apiBase}/api/book-chapters?id=${encodeURIComponent(bookId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.chapters) && data.chapters.length > 0) {
          // Permanently cache locally in IndexedDB so mobile can read 100% offline
          await this.saveChapters(bookId, data.chapters);
          return data.chapters;
        }
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

  // Bidirectional Local Server Sync (Hub)
  async syncWithServer() {
    try {
      const apiBase = (window.novelSources && typeof window.novelSources.getApiBaseUrl === 'function')
        ? window.novelSources.getApiBaseUrl()
        : '';
      const res = await fetch(`${apiBase}/api/sync`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const serverData = await res.json();

      const localShelf = this.getBookshelf();
      const localProgress = this.getAllProgress();
      const localSettings = this.getSettings();
      const localDeleted = this.getDeletedBookIds();
      const serverDeleted = Array.isArray(serverData.deletedIds) ? serverData.deletedIds : [];

      // Combine tombstones (any book deleted on either device remains deleted)
      const allDeleted = new Set([...localDeleted, ...serverDeleted]);
      try {
        localStorage.setItem(this.STORAGE_DELETED_KEY, JSON.stringify(Array.from(allDeleted)));
      } catch (e) {}

      if (serverData.empty) {
        // Server empty: push local shelf and progress to server
        const cleanShelf = localShelf.filter(b => !allDeleted.has(b.id));
        await fetch(`${apiBase}/api/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shelf: cleanShelf,
            progress: localProgress,
            settings: localSettings,
            deletedIds: Array.from(allDeleted)
          })
        });
        return { merged: false, pushed: true, count: cleanShelf.length, updatedAt: Date.now() };
      }

      // Merge server shelf and local shelf respecting tombstones
      const serverShelf = Array.isArray(serverData.shelf) ? serverData.shelf : [];
      const mergedShelf = [];

      // 1. Keep local books that have NOT been deleted
      for (const b of localShelf) {
        if (!allDeleted.has(b.id)) {
          mergedShelf.push(b);
        }
      }

      // 2. Add server books that have NOT been deleted and not already in mergedShelf
      for (const sBook of serverShelf) {
        if (allDeleted.has(sBook.id)) continue;
        const localIdx = mergedShelf.findIndex(b => b.id === sBook.id);
        if (localIdx === -1) {
          mergedShelf.push(sBook);
        } else {
          // If server copy has newer lastReadAt, keep server's progress
          if ((sBook.lastReadAt || 0) > (mergedShelf[localIdx].lastReadAt || 0)) {
            mergedShelf[localIdx] = { ...mergedShelf[localIdx], ...sBook };
          }
        }
      }

      // Merge progress & purge progress for deleted books
      const mergedProgress = { ...(serverData.progress || {}), ...(localProgress || {}) };
      for (const delId of allDeleted) {
        delete mergedProgress[delId];
      }

      this.saveBookshelf(mergedShelf);
      localStorage.setItem(this.STORAGE_PROGRESS_KEY, JSON.stringify(mergedProgress));

      // Push merged back to server with complete tombstone list
      await fetch(`${apiBase}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shelf: mergedShelf,
          progress: mergedProgress,
          settings: localSettings,
          deletedIds: Array.from(allDeleted)
        })
      });

      // Background sync all local book chapters to server hub
      setTimeout(() => {
        this.syncAllLocalChaptersToServer().catch(() => {});
      }, 300);

      return { merged: true, count: mergedShelf.length, updatedAt: serverData.updatedAt || Date.now() };
    } catch (err) {
      console.warn('[Sync] Local server sync failed:', err);
      throw err;
    }
  }

  // Push all local bookshelf chapters to server hub so other devices can read offline
  async syncAllLocalChaptersToServer() {
    const shelf = this.getBookshelf();
    for (const b of shelf) {
      try {
        const chapters = await this.getChapters(b.id);
        if (chapters && Array.isArray(chapters) && chapters.length > 0) {
          await this.pushChaptersToServer(b.id, chapters);
        }
      } catch (e) {}
    }
  }
}

window.novelDB = new NovelDB();

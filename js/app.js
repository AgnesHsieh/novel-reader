/**
 * Main Application Controller (微信讀書風 墨韻小說閱讀器)
 * Full coordination of Bookshelf, Multi-source Search, Progress Tracker, Settings & AI Audio TTS
 */

class NovelApp {
  constructor() {
    this.currentBook = null;
    this.currentChapterIndex = 0;
    this.currentFilter = 'all';
    this.isControlsVisible = false;
    this.scrollSaveDebounce = null;

    this.init();
  }

  async init() {
    try {
      this.applySettings(novelDB.getSettings());
      this.bindEvents();
      this.renderBookshelf();
      this.updateStatsUI();
      this.setupTTSEventHooks();

      // Check server health on startup
      novelSources.checkServerHealth().then(() => {
        this.updateStatsUI();
      });

      // Auto-sync with local server on startup
      setTimeout(() => {
        this.syncWithLocalServer(true);
      }, 500);
    } catch (err) {
      console.error('App init error:', err);
    }
  }

  // Safe element event binder
  on(id, event, callback) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener(event, callback);
    }
  }

  // =========================================================================
  // Navigation & Tab Switching
  // =========================================================================
  switchTab(tabName) {
    document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tabbar-item').forEach(b => b.classList.remove('active'));

    const targetPanel = document.getElementById(`view-${tabName}`);
    const targetBtn = document.querySelector(`.tabbar-item[data-tab="${tabName}"]`);

    if (targetPanel) targetPanel.classList.add('active');
    if (targetBtn) targetBtn.classList.add('active');

    if (tabName === 'shelf') {
      this.renderBookshelf();
      this.updateStatsUI();
    } else if (tabName === 'search') {
      this.renderDiscoverDefault();
    } else if (tabName === 'profile') {
      this.updateStatsUI();
      const s = novelDB.getSettings();
      const pDisplay = document.getElementById('profile-font-display');
      if (pDisplay) pDisplay.textContent = `${s.fontSize || 18} px`;
    }
  }

  showToast(message) {
    const toast = document.getElementById('wr-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2400);
  }

  // =========================================================================
  // Bookshelf Rendering & Management
  // =========================================================================
  renderBookshelf() {
    const shelf = novelDB.getBookshelf();
    const grid = document.getElementById('shelf-books-grid');
    if (!grid) return;

    if (this.isManageMode) {
      grid.classList.add('manage-mode');
    } else {
      grid.classList.remove('manage-mode');
    }

    // Filter
    let filtered = shelf;
    if (this.currentFilter === 'reading') {
      filtered = shelf.filter(b => (b.progress?.scrollPercent || 0) < 95);
    } else if (this.currentFilter === 'finished') {
      filtered = shelf.filter(b => (b.progress?.scrollPercent || 0) >= 95);
    }

    // Counts
    const allCountEl = document.getElementById('shelf-count-all');
    if (allCountEl) allCountEl.textContent = shelf.length;
    const readingCountEl = document.getElementById('shelf-count-reading');
    if (readingCountEl) readingCountEl.textContent = shelf.filter(b => (b.progress?.scrollPercent || 0) < 95).length;

    let html = '';

    filtered.forEach(book => {
      const prog = book.progress || { chapterIndex: 0, scrollPercent: 0, chapterTitle: '未讀' };
      const percent = prog.scrollPercent || 0;
      const chapterLabel = prog.chapterTitle || '第 1 章';

      html += `
        <div class="book-card" data-book-id="${book.id}">
          <button class="book-card-remove" data-book-id="${book.id}" data-book-title="${this.escapeHtml(book.title)}" title="移出書架" aria-label="移出書架">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div class="book-cover" style="background: ${book.coverBg || 'linear-gradient(135deg, #1f2937, #111827)'};">
            <div class="book-cover-title">${this.escapeHtml(this.formatChinese(book.title))}</div>
            <div class="book-cover-meta">
              <div class="book-cover-author">${this.escapeHtml(this.formatChinese(book.author))}</div>
              ${book.coverTag ? `<div class="book-cover-tag">${book.coverTag}</div>` : ''}
            </div>
          </div>
          <div class="book-progress-wrapper">
            <div class="book-progress-bar">
              <div class="book-progress-fill" style="width: ${percent}%;"></div>
            </div>
            <div class="book-progress-text">已讀 ${percent}% · ${this.escapeHtml(this.formatChinese(chapterLabel))}</div>
          </div>
        </div>
      `;
    });

    // Add Book card button - Wrapped in .book-card for identical height and alignment
    html += `
      <div class="book-card" id="btn-shelf-add-card">
        <div class="book-card-add">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span>搜尋 / 匯入新書</span>
        </div>
        <div class="book-progress-wrapper" style="visibility: hidden;">
          <div class="book-progress-bar"></div>
          <div class="book-progress-text">新書</div>
        </div>
      </div>
    `;

    grid.innerHTML = html;

    // Bind remove buttons
    grid.querySelectorAll('.book-card-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-book-id');
        const title = btn.getAttribute('data-book-title');
        this.confirmRemoveBook(id, title);
      });
    });

    // Bind card clicks
    grid.querySelectorAll('.book-card').forEach(card => {
      card.addEventListener('click', () => {
        const bookId = card.getAttribute('data-book-id');
        if (this.isManageMode) {
          const shelfItem = novelDB.getBookshelf().find(b => b.id === bookId);
          this.confirmRemoveBook(bookId, shelfItem?.title || '該書籍');
          return;
        }
        this.openBook(bookId);
      });
    });

    const addCard = document.getElementById('btn-shelf-add-card');
    if (addCard) {
      addCard.addEventListener('click', () => this.switchTab('search'));
    }
  }

  confirmRemoveBook(bookId, bookTitle) {
    const formattedTitle = this.formatChinese(bookTitle || '該書籍');
    const confirmed = confirm(`確定要將《${formattedTitle}》移出書架嗎？`);
    if (confirmed) {
      novelDB.removeFromShelf(bookId);
      this.renderBookshelf();
      this.showToast(`已將《${formattedTitle}》移出書架`);
    }
  }

  // =========================================================================
  // Reading Mode Engine (微信讀書風 沉浸式閱讀)
  // =========================================================================
  async openBook(bookId, targetChapterIndex = null) {
    try {
      this.showToast('正在開啟書籍...');
      
      let book = null;
      const shelfItem = novelDB.getBookshelf().find(b => b.id === bookId);
      const cached = await novelDB.getChapters(bookId);

      if (cached && Array.isArray(cached) && cached.length > 0 && shelfItem) {
        book = { ...shelfItem, chapters: cached };
      } else {
        const detailUrl = shelfItem?.detailUrl || (bookId.startsWith('http') ? bookId : null);
        book = await novelSources.getBookDetails(bookId, detailUrl, shelfItem?.title);
        // Cache fetched chapters immediately so subsequent opens are instant
        if (book && Array.isArray(book.chapters) && book.chapters.length > 0) {
          await novelDB.saveChapters(bookId, book.chapters);
          if (shelfItem) {
            if (!shelfItem.progress) shelfItem.progress = { chapterIndex: 0, scrollPercent: 0 };
            shelfItem.progress.totalChapters = book.chapters.length;
            novelDB.addToShelf(shelfItem);
          }
        }
      }

      if (!book || !book.chapters || book.chapters.length === 0) {
        throw new Error('未找到該書籍章節內容');
      }

      this.currentBook = book;

      const progress = novelDB.getProgress(book.id);
      let resumeChapter = 0;
      let resumePercent = 0;

      if (targetChapterIndex !== null) {
        resumeChapter = targetChapterIndex;
      } else if (progress) {
        resumeChapter = progress.chapterIndex || 0;
        resumePercent = progress.scrollPercent || 0;
      }

      this.currentChapterIndex = Math.min(resumeChapter, book.chapters.length - 1);

      document.getElementById('reader-viewport').classList.add('active');
      document.getElementById('reader-book-title').textContent = this.formatChinese(book.title);

      await this.loadChapter(this.currentChapterIndex, resumePercent);

      if (resumePercent > 5) {
        this.showToast(`為您跳轉至上次進度：${this.formatChinese(book.chapters[this.currentChapterIndex].title)} (${resumePercent}%)`);
      }
    } catch (err) {
      console.error('Failed to open book:', err);
      const shelfItem = novelDB.getBookshelf().find(b => b.id === bookId);
      const bookTitle = this.formatChinese(shelfItem ? shelfItem.title : '該書籍');
      const wantRemove = confirm(
        `無法開啟《${bookTitle}》: ${err.message}。\n\n` +
        `是否直接將此書【移出書架】？\n` +
        `（按「確定」立即移出書架，按「取消」保留）`
      );
      if (wantRemove) {
        novelDB.removeFromShelf(bookId);
        this.renderBookshelf();
        this.showToast(`已將《${bookTitle}》移出書架`);
      }
    }
  }

  // Download and cache chapters offline for the current book
  async cacheCurrentBookChapters() {
    if (!this.currentBook || !this.currentBook.chapters) {
      this.showToast('尚未載入書籍');
      return;
    }
    const chapters = this.currentBook.chapters;
    const uncached = chapters.filter(c => !c.content);

    if (uncached.length === 0) {
      this.showToast('本書所有章節均已離線快取完畢！');
      return;
    }

    const countChoice = prompt(
      `《${this.currentBook.title}》全書共 ${chapters.length} 章（尚有 ${uncached.length} 章未快取）。\n` +
      `請輸入欲離線下載的章節數量（例如：50 或輸入 all 下載全部）：`,
      '50'
    );
    if (!countChoice) return;

    let targetCount = countChoice.trim().toLowerCase() === 'all' ? uncached.length : parseInt(countChoice, 10);
    if (isNaN(targetCount) || targetCount <= 0) targetCount = 30;

    const toDownload = uncached.slice(0, targetCount);
    let downloaded = 0;
    this.showToast(`📥 開始離線下載 ${toDownload.length} 章，請保持網路連線...`);

    for (let i = 0; i < toDownload.length; i++) {
      const ch = toDownload[i];
      const actualIdx = this.currentBook.chapters.indexOf(ch);
      try {
        const full = await novelSources.getChapterContent(this.currentBook, actualIdx !== -1 ? actualIdx : i);
        if (full && full.content) {
          ch.content = full.content;
          ch.fontFace = full.fontFace;
          ch.fontFamily = full.fontFamily;
          downloaded++;
          if (downloaded % 5 === 0 || downloaded === toDownload.length) {
            this.showToast(`📥 離線下載進度: ${downloaded}/${toDownload.length} 章...`);
            await novelDB.saveChapters(this.currentBook.id, this.currentBook.chapters);
          }
        }
      } catch (err) {
        console.warn('Cache chapter failed:', err);
      }
    }

    await novelDB.saveChapters(this.currentBook.id, this.currentBook.chapters);
    this.showToast(`🎉 離線下載完成！已成功儲存 ${downloaded} 個章節，無網路時亦可流暢閱讀與 AI 聽書！`);
  }

  async loadChapter(chapterIndex, scrollPercent = 0) {
    if (!this.currentBook || !this.currentBook.chapters[chapterIndex]) return;

    this.currentChapterIndex = chapterIndex;
    const chapterMeta = this.currentBook.chapters[chapterIndex];
    const convertedTitle = this.formatChinese(chapterMeta.title);

    const topTitle = document.getElementById('reader-chapter-title-top');
    if (topTitle) topTitle.textContent = convertedTitle;
    const heading = document.getElementById('reader-chapter-heading');
    if (heading) heading.textContent = convertedTitle;
    const statusChapter = document.getElementById('status-bar-chapter');
    if (statusChapter) statusChapter.textContent = convertedTitle;

    const bodyEl = document.getElementById('reader-text-body');
    if (bodyEl) {
      bodyEl.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--wr-text-muted);">正在讀取章節內容...</div>';
    }

    const chapterData = await novelSources.getChapterContent(this.currentBook, chapterIndex);

    // Dynamic Font Injection (針對番茄小說等自定義 PUA 混淆字體自動加載解密字庫)
    let dynamicStyle = document.getElementById('dynamic-chapter-font');
    if (chapterData.fontFace) {
      if (!dynamicStyle) {
        dynamicStyle = document.createElement('style');
        dynamicStyle.id = 'dynamic-chapter-font';
        document.head.appendChild(dynamicStyle);
      }
      dynamicStyle.textContent = chapterData.fontFace;
      if (bodyEl && chapterData.fontFamily) {
        bodyEl.style.fontFamily = `"${chapterData.fontFamily}", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft JhengHei", "Microsoft YaHei", sans-serif`;
      }
    } else {
      if (dynamicStyle) dynamicStyle.textContent = '';
      if (bodyEl) bodyEl.style.fontFamily = '';
    }

    const convertedContent = this.formatChinese(chapterData.content);
    const paragraphs = convertedContent.split(/\r?\n+/).map(p => p.trim()).filter(Boolean);

    let html = '';
    paragraphs.forEach((p, idx) => {
      html += `<p class="reader-paragraph" data-para-idx="${idx}">${this.escapeHtml(p)}</p>`;
    });

    if (bodyEl) {
      bodyEl.innerHTML = html;
    }

    // Load TTS text
    novelTTS.loadText(convertedTitle, convertedContent);

    // Update Slider
    const totalChapters = this.currentBook.chapters.length;
    const slider = document.getElementById('reader-progress-slider');
    if (slider) {
      slider.max = totalChapters - 1;
      slider.value = chapterIndex;
    }

    // Restore scroll position
    const scrollCanvas = document.getElementById('reader-scroll-canvas');
    if (scrollCanvas) {
      if (scrollPercent > 0) {
        setTimeout(() => {
          const targetScroll = (scrollCanvas.scrollHeight - scrollCanvas.clientHeight) * (scrollPercent / 100);
          scrollCanvas.scrollTop = targetScroll;
        }, 100);
      } else {
        scrollCanvas.scrollTop = 0;
      }
    }

    this.saveCurrentProgress();
    this.updateStatusBar();
    this.renderTOC();
    this.updateShelfButtonState();
  }

  saveCurrentProgress() {
    if (!this.currentBook) return;

    const scrollCanvas = document.getElementById('reader-scroll-canvas');
    if (!scrollCanvas) return;
    const scrollMax = scrollCanvas.scrollHeight - scrollCanvas.clientHeight;
    const percent = scrollMax > 0 ? Math.round((scrollCanvas.scrollTop / scrollMax) * 100) : 0;

    novelDB.saveProgress(this.currentBook.id, {
      chapterIndex: this.currentChapterIndex,
      chapterTitle: this.currentBook.chapters[this.currentChapterIndex]?.title || '',
      scrollPercent: percent,
      totalChapters: this.currentBook.chapters.length
    });
  }

  updateStatusBar() {
    const scrollCanvas = document.getElementById('reader-scroll-canvas');
    if (!scrollCanvas) return;
    const scrollMax = scrollCanvas.scrollHeight - scrollCanvas.clientHeight;
    const percent = scrollMax > 0 ? Math.round((scrollCanvas.scrollTop / scrollMax) * 100) : 0;
    const percentEl = document.getElementById('status-bar-percent');
    if (percentEl) percentEl.textContent = `${percent}%`;
  }

  toggleReaderControls() {
    this.isControlsVisible = !this.isControlsVisible;
    const topBar = document.getElementById('reader-top-bar');
    const bottomBar = document.getElementById('reader-bottom-bar');

    if (this.isControlsVisible) {
      if (topBar) topBar.classList.add('visible');
      if (bottomBar) bottomBar.classList.add('visible');
    } else {
      if (topBar) topBar.classList.remove('visible');
      if (bottomBar) bottomBar.classList.remove('visible');
    }
  }

  closeReader() {
    this.saveCurrentProgress();
    const viewport = document.getElementById('reader-viewport');
    if (viewport) viewport.classList.remove('active');
    this.renderBookshelf();
  }

  // =========================================================================
  // TOC Drawer (目錄側邊欄)
  // =========================================================================
  renderTOC() {
    if (!this.currentBook) return;

    const list = document.getElementById('toc-items-list');
    const countEl = document.getElementById('toc-total-count');
    if (countEl) countEl.textContent = this.currentBook.chapters.length;
    if (!list) return;

    let html = '';
    this.currentBook.chapters.forEach((ch, idx) => {
      const isCurrent = idx === this.currentChapterIndex;
      html += `
        <div class="toc-item ${isCurrent ? 'current' : ''}" data-ch-idx="${idx}">
          <span>${this.escapeHtml(this.formatChinese(ch.title))}</span>
          ${isCurrent ? '<span class="toc-badge">閱讀中</span>' : ''}
        </div>
      `;
    });

    list.innerHTML = html;

    list.querySelectorAll('.toc-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.getAttribute('data-ch-idx'), 10);
        this.closeTOC();
        this.loadChapter(idx, 0);
      });
    });
  }

  openTOC() {
    this.renderTOC();
    const el = document.getElementById('toc-drawer-overlay');
    if (el) el.classList.add('active');
  }

  closeTOC() {
    const el = document.getElementById('toc-drawer-overlay');
    if (el) el.classList.remove('active');
  }

  // =========================================================================
  // Appearance & Settings Sheet
  // =========================================================================
  openSettings() {
    const el = document.getElementById('settings-sheet-overlay');
    if (el) el.classList.add('active');
  }

  closeSettings() {
    const el = document.getElementById('settings-sheet-overlay');
    if (el) el.classList.remove('active');
  }

  applySettings(s) {
    document.body.setAttribute('data-theme', s.theme || 'paper');
    document.documentElement.style.setProperty('--reader-font-size', `${s.fontSize || 18}px`);
    document.documentElement.style.setProperty('--reader-line-height', `${s.lineHeight || 1.85}`);

    const display = document.getElementById('font-size-display');
    if (display) display.textContent = `${s.fontSize} px`;

    const profileDisplay = document.getElementById('profile-font-display');
    if (profileDisplay) profileDisplay.textContent = `${s.fontSize} px`;

    const bodyEl = document.getElementById('reader-text-body');
    if (bodyEl) {
      bodyEl.className = `font-${s.fontFamily || 'system'}`;
    }

    document.querySelectorAll('.theme-chip-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-theme-val') === s.theme);
    });

    document.querySelectorAll('#font-family-control .segment-item-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-font') === s.fontFamily);
    });

    document.querySelectorAll('#line-spacing-control .segment-item-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-spacing') === String(s.lineHeight));
    });

    document.querySelectorAll('#chinese-mode-control .segment-item-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-chinese-mode') === (s.chineseMode || 's2t'));
    });
  }

  // Chinese conversion helper (簡繁轉換)
  formatChinese(text) {
    if (!text) return '';
    const s = novelDB.getSettings();
    if (s.chineseMode === 'origin') {
      return text;
    }
    return window.ChineseConv ? window.ChineseConv.s2t(text) : text;
  }

  updateShelfButtonState() {
    if (!this.currentBook) return;
    const inShelf = novelDB.isInShelf(this.currentBook.id);

    // Bottom toolbar button
    const bottomBtn = document.getElementById('btn-tool-shelf');
    const label = document.getElementById('btn-tool-shelf-text');
    if (bottomBtn) {
      bottomBtn.classList.toggle('in-shelf', inShelf);
    }
    if (label) {
      label.textContent = inShelf ? '✓ 已在書架' : '加入書架';
    }

    // Top navigation bar bookmark button
    const topBtn = document.getElementById('btn-reader-shelf-top');
    const topIcon = document.getElementById('top-shelf-icon');
    if (topBtn) {
      topBtn.classList.toggle('in-shelf', inShelf);
      topBtn.setAttribute('title', inShelf ? '已在書架中（點擊移出）' : '收藏至書架');
    }
    if (topIcon) {
      topIcon.setAttribute('fill', inShelf ? 'currentColor' : 'none');
    }
  }

  toggleCurrentBookShelf() {
    if (!this.currentBook) return;
    const inShelf = novelDB.isInShelf(this.currentBook.id);
    if (inShelf) {
      novelDB.removeFromShelf(this.currentBook.id);
      this.updateShelfButtonState();
      this.renderBookshelf();
      this.showToast(`已將《${this.formatChinese(this.currentBook.title)}》移出書架`);
    } else {
      novelDB.addToShelf(this.currentBook);
      this.updateShelfButtonState();
      this.renderBookshelf();
      this.showToast(`✓ 已將《${this.formatChinese(this.currentBook.title)}》收藏至書架`);
    }
  }

  // =========================================================================
  // AI Audio Listening Engine (微信讀書 AI 聽書同款)
  // =========================================================================
  setupTTSEventHooks() {
    novelTTS.onParagraphChange = (audioIdx, text, domParaIdx) => {
      document.querySelectorAll('.reader-paragraph').forEach(p => p.classList.remove('speaking-active'));
      const headingEl = document.getElementById('reader-chapter-heading');
      if (headingEl) headingEl.classList.remove('speaking-active');

      if (domParaIdx === -1) {
        if (headingEl) {
          headingEl.classList.add('speaking-active');
          headingEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else {
        const activeEl = document.querySelector(`.reader-paragraph[data-para-idx="${domParaIdx}"]`);
        if (activeEl) {
          activeEl.classList.add('speaking-active');
          activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }

      const teleEl = document.getElementById('teleprompter-text');
      if (teleEl) {
        teleEl.textContent = text;
      }
    };

    novelTTS.onStateChange = () => {
      const isPlaying = novelTTS.isPlaying && !novelTTS.isPaused;
      const miniPill = document.getElementById('audio-mini-pill');
      const miniDisc = document.getElementById('mini-disc');
      const bigDisc = document.getElementById('audio-big-disc');
      const miniIcon = document.getElementById('mini-play-icon');
      const bigIcon = document.getElementById('audio-main-play-icon');

      if (miniPill) {
        if (novelTTS.isPlaying || novelTTS.isPaused) {
          miniPill.style.display = 'flex';
        }
      }

      if (miniDisc) miniDisc.classList.toggle('playing', isPlaying);
      if (bigDisc) bigDisc.classList.toggle('playing', isPlaying);

      if (miniIcon) {
        miniIcon.innerHTML = isPlaying
          ? '<path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>'
          : '<path d="M8 5v14l11-7z"/>';
      }

      if (bigIcon) {
        bigIcon.innerHTML = isPlaying
          ? '<path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>'
          : '<path d="M8 5v14l11-7z"/>';
      }

      this.updateAudioVoiceLabel();
    };

    novelTTS.onVoicesReady = () => {
      this.updateAudioVoiceLabel();
    };

    novelTTS.onChapterFinished = () => {
      if (this.currentBook && this.currentChapterIndex < this.currentBook.chapters.length - 1) {
        this.loadChapter(this.currentChapterIndex + 1, 0).then(() => {
          novelTTS.play();
        });
      }
    };

    novelTTS.onSleepTick = (formatted, remainingSec, timerType) => {
      this.updateSleepTimerUI(formatted, remainingSec, timerType);
    };
  }

  updateSleepTimerUI(formatted, remainingSec, timerType) {
    const isActive = Boolean(formatted);

    // 1. Audio Sheet button & label
    const label = document.getElementById('label-audio-timer');
    const timerBtn = document.getElementById('btn-audio-timer-pick');
    if (label) {
      label.textContent = isActive ? `定時: ${formatted}` : '定時關閉';
    }
    if (timerBtn) {
      timerBtn.classList.toggle('timer-active', isActive);
    }

    // 2. Audio Player Sheet live banner
    const banner = document.getElementById('audio-timer-banner');
    if (banner) {
      if (isActive) {
        banner.style.display = 'block';
        if (timerType === 'chapter') {
          banner.textContent = '⏱️ 已開啟定時：讀完本章後自動停止（點擊修改）';
        } else {
          banner.textContent = `⏱️ 定時倒計時：${formatted} 後自動暫停（點擊修改）`;
        }
      } else {
        banner.style.display = 'none';
      }
    }

    // 3. Mini floating pill live timer
    const miniTimer = document.getElementById('mini-pill-timer');
    if (miniTimer) {
      if (isActive) {
        miniTimer.style.display = 'inline-block';
        miniTimer.textContent = `⏱️ ${formatted}`;
      } else {
        miniTimer.style.display = 'none';
      }
    }

    // 4. Reader bottom status bar
    const statusTimer = document.getElementById('status-bar-timer');
    if (statusTimer) {
      if (isActive) {
        statusTimer.style.display = 'inline';
        statusTimer.textContent = `⏱️ ${formatted}`;
      } else {
        statusTimer.style.display = 'none';
      }
    }

    // 5. Reader bottom toolbar timer badge & label
    const readerTimerBadge = document.getElementById('reader-timer-badge');
    const readerTimerLabel = document.getElementById('reader-timer-toolbar-label');
    if (readerTimerBadge) {
      if (isActive) {
        readerTimerBadge.style.display = 'inline-block';
        readerTimerBadge.textContent = formatted;
      } else {
        readerTimerBadge.style.display = 'none';
      }
    }
    if (readerTimerLabel) {
      readerTimerLabel.textContent = isActive ? formatted : '定時關閉';
    }

    // 6. Timer Picker Modal live components (大數字即時倒數與卡片狀態)
    const activeBox = document.getElementById('timer-active-box');
    const inactiveBox = document.getElementById('timer-inactive-box');
    const countdownBig = document.getElementById('timer-modal-countdown');
    const modalSub = document.getElementById('timer-modal-sub');

    if (activeBox && inactiveBox) {
      if (isActive) {
        activeBox.style.display = 'flex';
        inactiveBox.style.display = 'none';
        if (countdownBig) countdownBig.textContent = formatted;
        if (modalSub) {
          modalSub.textContent = timerType === 'chapter' ? '本章節播講完畢後自動暫停' : '時間到達後將自動暫停朗讀';
        }
      } else {
        activeBox.style.display = 'none';
        inactiveBox.style.display = 'flex';
      }
    }

    // Highlight active preset button
    document.querySelectorAll('.timer-preset-btn').forEach(btn => {
      const val = btn.getAttribute('data-timer');
      if (isActive && (val == timerType || (timerType && val === String(timerType)))) {
        btn.classList.add('selected');
      } else {
        btn.classList.remove('selected');
      }
    });
  }

  openTimerModal() {
    const status = novelTTS.getSleepTimerStatus();
    this.updateSleepTimerUI(status.formatted, status.remainingSeconds, status.type);
    const modal = document.getElementById('timer-picker-modal');
    if (modal) modal.classList.add('active');
  }

  openAudioSheet() {
    this.updateAudioVoiceLabel();
    if (!novelTTS.isPlaying && !novelTTS.isPaused) {
      const startIdx = this.findCurrentVisibleParagraphIndex();
      novelTTS.jumpToParagraph(startIdx);
      novelTTS.play();
    }
    const modal = document.getElementById('audio-player-modal');
    if (modal) modal.classList.add('active');
  }

  // Find paragraph nearest to visible viewport top so listening doesn't restart from beginning
  findCurrentVisibleParagraphIndex() {
    const scrollCanvas = document.getElementById('reader-scroll-canvas');
    if (!scrollCanvas) return -1;
    // If scrolled at very top (< 40px), read from chapter heading
    if (scrollCanvas.scrollTop < 40) return -1;

    const paragraphs = document.querySelectorAll('.reader-paragraph');
    const canvasRect = scrollCanvas.getBoundingClientRect();
    const targetY = canvasRect.top + 60;

    for (let i = 0; i < paragraphs.length; i++) {
      const rect = paragraphs[i].getBoundingClientRect();
      if (rect.bottom >= targetY) {
        const idx = parseInt(paragraphs[i].getAttribute('data-para-idx') || '0', 10);
        return isNaN(idx) ? 0 : idx;
      }
    }
    return 0;
  }

  startTTSFromParagraph(paraIdx) {
    this.hideParaQuickAction();
    novelTTS.jumpToParagraph(paraIdx);
    if (!novelTTS.isPlaying || novelTTS.isPaused) {
      novelTTS.play();
    }
    this.updateAudioVoiceLabel();
    this.showToast(paraIdx === -1 ? '▶ 開始朗讀章節標題' : `▶ 從第 ${paraIdx + 1} 段開始朗讀`);
  }

  showParaQuickAction(targetEl, paraIdx) {
    const pill = document.getElementById('para-quick-action');
    const scrollCanvas = document.getElementById('reader-scroll-canvas');
    if (!pill || !scrollCanvas || !targetEl) return;

    this.selectedParaIdx = paraIdx;
    const canvasRect = scrollCanvas.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();

    const top = (targetRect.top - canvasRect.top) + scrollCanvas.scrollTop;
    const left = (targetRect.left - canvasRect.left) + (targetRect.width / 2);

    pill.style.top = `${Math.max(10, top)}px`;
    pill.style.left = `${Math.max(60, Math.min(canvasRect.width - 60, left))}px`;
    pill.classList.add('active');
  }

  hideParaQuickAction() {
    const pill = document.getElementById('para-quick-action');
    if (pill) pill.classList.remove('active');
    this.selectedParaIdx = null;
  }

  // Bidirectional Local Server Sync (Hub: http://192.168.0.114:3001)
  async syncWithLocalServer(silent = false) {
    try {
      const syncStatusEl = document.getElementById('stat-sync-status');
      if (syncStatusEl) {
        syncStatusEl.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#f59e0b;"></span> 同步中...`;
      }
      const res = await novelDB.syncWithServer();
      this.renderBookshelf();
      this.updateStatsUI();
      const host = window.location.hostname || 'localhost';
      const port = window.location.port || '3001';
      if (syncStatusEl) {
        syncStatusEl.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#10b981;"></span> ${host}:${port}`;
      }
      if (!silent) {
        this.showToast(`✓ 已與伺服器 (${host}:${port}) 同步最新書架 (${res.count} 本)`);
      }
    } catch (err) {
      const syncStatusEl = document.getElementById('stat-sync-status');
      if (syncStatusEl) {
        syncStatusEl.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#ef4444;"></span> 伺服器未連線`;
      }
      if (!silent) {
        this.showToast('⚠️ 連線伺服器失敗，請確認已執行 node server.js');
      }
    }
  }

  updateAudioVoiceLabel() {
    const voiceName = novelTTS.getCurrentVoiceName();
    const labelVoice = document.getElementById('label-audio-voice');
    if (labelVoice) labelVoice.textContent = voiceName;
    const miniVoice = document.getElementById('mini-pill-voice');
    if (miniVoice) miniVoice.textContent = `${voiceName} · 正在播講`;
  }

  closeAudioSheet() {
    const modal = document.getElementById('audio-player-modal');
    if (modal) modal.classList.remove('active');
  }

  renderVoiceItemHtml(v) {
    return `
      <div class="voice-item ${v.isSelected ? 'selected' : ''}" data-voice-idx="${v.index}" style="margin-bottom: 8px;">
        <div style="display: flex; align-items: center; gap: 12px; flex: 1; cursor: pointer;" class="voice-select-trigger" data-voice-idx="${v.index}">
          <span style="font-size: 24px;">${v.icon}</span>
          <div>
            <div style="font-weight: 700; font-size: 14px; color: var(--wr-text);">${this.escapeHtml(v.name)}</div>
            <div style="font-size: 11px; color: var(--wr-text-secondary); margin-top: 2px;">${this.escapeHtml(v.tag)}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button type="button" class="btn-preview-voice action-pill-btn" data-voice-idx="${v.index}" style="padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; color: var(--wr-primary); border-color: var(--wr-primary);">▶ 試聽</button>
          <button type="button" class="btn-choose-voice action-pill-btn" data-voice-idx="${v.index}" style="padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; ${v.isSelected ? 'background: var(--wr-primary); color: #fff; border-color: var(--wr-primary);' : ''}">
            ${v.isSelected ? '使用中 ✓' : '選用'}
          </button>
        </div>
      </div>
    `;
  }

  renderVoicePicker() {
    const voices = novelTTS.getVoiceList();
    const list = document.getElementById('voice-list-container');
    if (!list) return;

    const maleVoices = voices.filter(v => v.gender === 'male');
    const femaleVoices = voices.filter(v => v.gender === 'female');
    const systemVoices = voices.filter(v => v.gender === 'system');

    let html = '';

    // Section 1: 男聲類型
    if (maleVoices.length > 0) {
      html += `
        <div style="font-size: 13px; font-weight: 700; color: var(--wr-primary); margin: 6px 0 8px; display: flex; align-items: center; gap: 4px;">
          <span>👨 男聲類型</span>
        </div>
      `;
      maleVoices.forEach(v => {
        html += this.renderVoiceItemHtml(v);
      });
    }

    // Section 2: 女聲類型
    if (femaleVoices.length > 0) {
      html += `
        <div style="font-size: 13px; font-weight: 700; color: #ec4899; margin: 16px 0 8px; display: flex; align-items: center; gap: 4px;">
          <span>👩 女聲類型</span>
        </div>
      `;
      femaleVoices.forEach(v => {
        html += this.renderVoiceItemHtml(v);
      });
    }

    // Section 3: 系統預設
    if (systemVoices.length > 0) {
      html += `
        <div style="font-size: 13px; font-weight: 700; color: var(--wr-text-secondary); margin: 16px 0 8px; display: flex; align-items: center; gap: 4px;">
          <span>💻 系統預設</span>
        </div>
      `;
      systemVoices.forEach(v => {
        html += this.renderVoiceItemHtml(v);
      });
    }

    list.innerHTML = html;

    list.querySelectorAll('.btn-preview-voice').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-voice-idx'), 10);
        novelTTS.previewVoice(idx);
        this.showToast(`正在試聽「${voices[idx].name}」...`);
      });
    });

    const selectVoice = (idx) => {
      novelTTS.setVoiceByIndex(idx);
      this.closeVoicePicker();
      this.updateAudioVoiceLabel();
      this.showToast(`已切換聽書聲音為：${voices[idx].name}`);
    };

    list.querySelectorAll('.btn-choose-voice, .voice-select-trigger').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.getAttribute('data-voice-idx'), 10);
        selectVoice(idx);
      });
    });
  }

  openVoicePicker() {
    this.renderVoicePicker();
    const modal = document.getElementById('voice-picker-modal');
    if (modal) modal.classList.add('active');
  }

  closeVoicePicker() {
    const modal = document.getElementById('voice-picker-modal');
    if (modal) modal.classList.remove('active');
  }

  // =========================================================================
  // Search Engine & Free Novel Discovery
  // =========================================================================
  renderDiscoverDefault() {
    const list = document.getElementById('search-results-list');
    const input = document.getElementById('search-input');
    if (!list) return;

    // If user has typed a query, don't clobber it
    if (input && input.value.trim()) return;

    const isOnline = novelSources.isServerOnline;
    const defaultBooks = novelSources.localBooks || [];

    let serverNotice = '';
    if (isOnline === false) {
      serverNotice = `
        <div style="margin-bottom: 16px; padding: 12px 14px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: var(--wr-radius-md); font-size: 13px; color: var(--wr-text); display: flex; align-items: center; justify-content: space-between; gap: 10px;">
          <div>
            <div style="color: #ef4444; font-weight: 700; display: flex; align-items: center; gap: 6px;">
              <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#ef4444;"></span>
              全網檢索伺服器未啟動（目前為離線閱讀模式）
            </div>
            <div style="color: var(--wr-text-secondary); font-size: 11.5px; margin-top: 3px;">
              在專案終端機執行 <code>node server.js</code> 即可解鎖全網千萬本免費小說即時搜尋！
            </div>
          </div>
          <button id="btn-recheck-server" class="action-pill-btn mini" style="white-space: nowrap; font-weight: 600;">🔄 測試連線</button>
        </div>
      `;
    } else if (isOnline === true) {
      serverNotice = `
        <div style="margin-bottom: 14px; padding: 8px 14px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: var(--wr-radius-md); font-size: 12px; color: #10b981; display: flex; align-items: center; gap: 6px;">
          <span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:#10b981;"></span>
          全網即時免費小說搜尋引擎已就緒，支援數十萬本網路小說即時檢索
        </div>
      `;
    }

    let html = serverNotice;

    // Categories
    html += `
      <div style="margin-bottom: 20px;">
        <div style="font-size: 14px; font-weight: 700; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
          <span>🔥 熱門題材分類</span>
          <span style="font-size: 11px; color: var(--wr-text-secondary);">點擊快速探索</span>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="action-pill-btn search-category-chip" data-cat="玄幻熱血">玄幻熱血</button>
          <button class="action-pill-btn search-category-chip" data-cat="古典仙俠">古典仙俠</button>
          <button class="action-pill-btn search-category-chip" data-cat="仙俠探案">仙俠探案</button>
          <button class="action-pill-btn search-category-chip" data-cat="歷史傳奇">歷史傳奇</button>
          <button class="action-pill-btn search-category-chip" data-cat="科幻末世">科幻末世</button>
          <button class="action-pill-btn search-category-chip" data-cat="古典名著">古典名著</button>
        </div>
      </div>
    `;

    // Featured Curated Books
    html += `
      <div>
        <div style="font-size: 14px; font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
          <span>⭐ 精選人氣神作 (${defaultBooks.length} 本即點即讀)</span>
          <span style="font-size: 11px; color: var(--wr-text-secondary);">官方校對</span>
        </div>
        <div id="discover-books-list">
    `;

    defaultBooks.forEach(book => {
      const inShelf = novelDB.isInShelf(book.id);
      const displayTitle = this.formatChinese(book.title);
      const displayAuthor = this.formatChinese(book.author);
      const displayCategory = this.formatChinese(book.category || '網絡小說');
      const displayIntro = this.formatChinese(book.intro || '暫無簡介');

      html += `
        <div class="result-card" data-book-id="${book.id}">
          <div class="result-mini-cover" style="background: ${book.coverBg || 'linear-gradient(135deg, #2563eb, #1e40af)'};">
            ${inShelf ? '<div class="cover-shelf-ribbon">✓ 已收藏</div>' : ''}
            ${this.escapeHtml(displayTitle)}
          </div>
          <div class="result-info">
            <div>
              <div class="result-title">
                <span>${this.escapeHtml(displayTitle)}</span>
                <span class="source-badge">${book.coverTag || '官方精校'}</span>
              </div>
              <div class="result-author">${this.escapeHtml(displayAuthor)} · ${this.escapeHtml(displayCategory)}</div>
              <div class="result-desc">${this.escapeHtml(displayIntro)}</div>
            </div>
            <div class="result-actions">
              <button class="btn-read-now" data-action="read" data-book-id="${book.id}">立即閱讀</button>
              <button class="btn-add-shelf ${inShelf ? 'in-shelf' : ''}" data-action="add-shelf" data-book-id="${book.id}">
                ${inShelf ? '✓ 已在書架' : '+ 加入書架'}
              </button>
            </div>
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;

    list.innerHTML = html;

    // Category clicks
    list.querySelectorAll('.search-category-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = btn.getAttribute('data-cat');
        const sInput = document.getElementById('search-input');
        if (sInput) sInput.value = cat;
        this.doSearch(cat);
      });
    });

    // Recheck server button
    const recheckBtn = list.querySelector('#btn-recheck-server');
    if (recheckBtn) {
      recheckBtn.addEventListener('click', async () => {
        recheckBtn.textContent = '連線測試中...';
        await novelSources.checkServerHealth();
        this.renderDiscoverDefault();
        this.showToast(novelSources.isServerOnline ? '✓ 伺服器連線成功！' : '伺服器仍未連線，請確認在終端執行 node server.js');
      });
    }

    this.bindResultCardEvents(list, defaultBooks);
  }

  bindResultCardEvents(container, booksList) {
    container.querySelectorAll('.result-card').forEach(card => {
      const bookId = card.getAttribute('data-book-id');
      const bookData = booksList.find(r => r.id === bookId);

      const readBtn = card.querySelector('[data-action="read"]');
      if (readBtn && bookData) {
        readBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          novelDB.addToShelf(bookData);
          this.openBook(bookId);
        });
      }

      const shelfBtn = card.querySelector('[data-action="add-shelf"]');
      if (shelfBtn && bookData) {
        shelfBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const nowInShelf = novelDB.isInShelf(bookId);
          if (nowInShelf) {
            this.showToast(`《${this.formatChinese(bookData.title)}》已在書架中`);
            return;
          }
          novelDB.addToShelf(bookData);
          shelfBtn.classList.add('in-shelf');
          shelfBtn.textContent = '✓ 已在書架';
          const coverEl = card.querySelector('.result-mini-cover');
          if (coverEl && !coverEl.querySelector('.cover-shelf-ribbon')) {
            coverEl.insertAdjacentHTML('afterbegin', '<div class="cover-shelf-ribbon">✓ 已收藏</div>');
          }
          this.renderBookshelf();
          this.showToast(`✓ 已將《${this.formatChinese(bookData.title)}》加入書架！`);
        });
      }
    });
  }

  async doSearch(keyword) {
    if (!keyword || !keyword.trim()) {
      this.renderDiscoverDefault();
      return;
    }

    const list = document.getElementById('search-results-list');
    if (!list) return;

    list.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--wr-text-secondary);">
        <div style="font-size: 26px; margin-bottom: 10px;">🔍</div>
        正在全網搜尋免費小說《${this.escapeHtml(keyword)}》...
      </div>
    `;

    try {
      const results = await novelSources.search(keyword);

      if (results.length === 0) {
        const isOffline = novelSources.isServerOnline === false;
        list.innerHTML = `
          <div style="text-align: center; padding: 40px 20px; color: var(--wr-text-secondary);">
            <div style="font-size: 34px; margin-bottom: 12px;">${isOffline ? '📡' : '🔍'}</div>
            <div style="font-weight: 700; font-size: 16px; margin-bottom: 8px; color: var(--wr-text);">
              ${isOffline ? '後端伺服器未連線' : `未找到與「${this.escapeHtml(keyword)}」相關的小說`}
            </div>
            <div style="font-size: 13px; line-height: 1.6; max-width: 440px; margin: 0 auto 16px;">
              ${isOffline
                ? `目前後端服務尚未啟動，無法進行全網即時抓取。<br>請在專案目錄終端機執行 <code>node server.js</code> 即可解鎖全網數百萬本免費小說搜尋！`
                : `建議嘗試不同關鍵字（如書名簡稱、作者名稱），或點選上方熱搜標籤。`}
            </div>
            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
              <button id="btn-search-show-discover" class="action-pill-btn" style="padding: 6px 16px; font-weight: 600;">⭐ 查看精選神作推薦</button>
              ${isOffline ? '<button id="btn-search-retry-offline" class="action-pill-btn secondary" style="padding: 6px 16px;">🔄 測試連線</button>' : ''}
            </div>
          </div>
        `;

        const showDiscoverBtn = list.querySelector('#btn-search-show-discover');
        if (showDiscoverBtn) {
          showDiscoverBtn.addEventListener('click', () => {
            const sInput = document.getElementById('search-input');
            if (sInput) sInput.value = '';
            this.renderDiscoverDefault();
          });
        }

        const retryBtn = list.querySelector('#btn-search-retry-offline');
        if (retryBtn) {
          retryBtn.addEventListener('click', async () => {
            retryBtn.textContent = '測試中...';
            await novelSources.checkServerHealth();
            this.doSearch(keyword);
          });
        }
        return;
      }

      let html = `
        <div style="margin-bottom: 12px; font-size: 12px; color: var(--wr-text-secondary); display: flex; align-items: center; justify-content: space-between;">
          <span>搜尋「${this.escapeHtml(keyword)}」找到 ${results.length} 本相關小說</span>
          <button id="btn-clear-search-view" class="action-pill-btn mini">返回推薦</button>
        </div>
      `;

      results.forEach(book => {
        const inShelf = novelDB.isInShelf(book.id);
        const displayTitle = this.formatChinese(book.title);
        const displayAuthor = this.formatChinese(book.author);
        const displayCategory = this.formatChinese(book.category || '網絡小說');
        const displayIntro = this.formatChinese(book.intro || '暫無簡介');

        html += `
          <div class="result-card" data-book-id="${book.id}">
            <div class="result-mini-cover" style="background: ${book.coverBg || 'linear-gradient(135deg, #2563eb, #1e40af)'};">
              ${inShelf ? '<div class="cover-shelf-ribbon">✓ 已收藏</div>' : ''}
              ${this.escapeHtml(displayTitle)}
            </div>
            <div class="result-info">
              <div>
                <div class="result-title">
                  <span>${this.escapeHtml(displayTitle)}</span>
                  <span class="source-badge">${book.sourceBadge || '免費源'}</span>
                </div>
                <div class="result-author">${this.escapeHtml(displayAuthor)} · ${this.escapeHtml(displayCategory)}</div>
                <div class="result-desc">${this.escapeHtml(displayIntro)}</div>
              </div>
              <div class="result-actions">
                <button class="btn-read-now" data-action="read" data-book-id="${book.id}">立即閱讀</button>
                <button class="btn-add-shelf ${inShelf ? 'in-shelf' : ''}" data-action="add-shelf" data-book-id="${book.id}">
                  ${inShelf ? '✓ 已在書架' : '+ 加入書架'}
                </button>
              </div>
            </div>
          </div>
        `;
      });

      list.innerHTML = html;

      const clearBtn = list.querySelector('#btn-clear-search-view');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          const sInput = document.getElementById('search-input');
          if (sInput) sInput.value = '';
          this.renderDiscoverDefault();
        });
      }

      this.bindResultCardEvents(list, results);
    } catch (err) {
      list.innerHTML = `<div style="text-align: center; padding: 30px; color: #ef4444;">搜尋發生錯誤: ${err.message}</div>`;
    }
  }

  // =========================================================================
  // Stats & Profile UI
  // =========================================================================
  updateStatsUI() {
    const shelf = novelDB.getBookshelf();
    const shelfCountEl = document.getElementById('stat-shelf-total');
    if (shelfCountEl) shelfCountEl.textContent = `${shelf.length} 本`;

    const syncStatusEl = document.getElementById('stat-sync-status');
    if (syncStatusEl) {
      const isOnline = novelSources.isServerOnline;
      if (isOnline === false) {
        syncStatusEl.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#ef4444;"></span> 伺服器未連線`;
        syncStatusEl.style.color = '#ef4444';
      } else {
        const sInfo = novelSources.serverInfo;
        const displayIp = (sInfo && sInfo.primaryIp) ? `${sInfo.primaryIp}:3001` : (window.location.host || 'localhost:3001');
        syncStatusEl.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#10b981;"></span> ${displayIp}`;
        syncStatusEl.style.color = '#10b981';
      }
    }
  }

  // =========================================================================
  // Event Binding
  // =========================================================================
  bindEvents() {
    // Tab switching
    document.querySelectorAll('.tabbar-item').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.getAttribute('data-tab'));
      });
    });

    // Bookshelf filter tabs
    document.querySelectorAll('.shelf-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.shelf-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.getAttribute('data-filter');
        this.renderBookshelf();
      });
    });

    // Quick Search button in header
    this.on('btn-quick-search', 'click', () => {
      this.switchTab('search');
      const input = document.getElementById('search-input');
      if (input) input.focus();
    });

    // Search triggers
    this.on('btn-do-search', 'click', () => {
      const q = document.getElementById('search-input')?.value;
      this.doSearch(q);
    });

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.doSearch(e.target.value);
        }
      });
      searchInput.addEventListener('input', (e) => {
        if (!e.target.value.trim()) {
          this.renderDiscoverDefault();
        }
      });
    }

    // Hot search tags
    document.querySelectorAll('.tag-chip[data-kw]').forEach(chip => {
      chip.addEventListener('click', () => {
        const kw = chip.getAttribute('data-kw');
        const sInput = document.getElementById('search-input');
        if (sInput) sInput.value = kw;
        this.doSearch(kw);
      });
    });

    // Reader View Canvas Center Tap -> Toggle Controls
    const scrollCanvas = document.getElementById('reader-scroll-canvas');
    if (scrollCanvas) {
      scrollCanvas.addEventListener('click', (e) => {
        if (e.target.closest('.reader-chapter-actions') || e.target.closest('button')) return;

        const paraEl = e.target.closest('.reader-paragraph');
        const headingEl = e.target.closest('#reader-chapter-heading');

        if (paraEl || headingEl) {
          const paraIdx = headingEl ? -1 : parseInt(paraEl.getAttribute('data-para-idx') || '0', 10);
          // If already playing audio, tapping any paragraph immediately jumps reading to it!
          if (novelTTS.isPlaying) {
            this.startTTSFromParagraph(paraIdx);
            return;
          }
          // If audio not playing, show the sleek floating "從此處朗讀" action pill!
          this.showParaQuickAction(headingEl || paraEl, paraIdx);
          return;
        }

        this.hideParaQuickAction();
        this.toggleReaderControls();
      });

      scrollCanvas.addEventListener('dblclick', (e) => {
        const paraEl = e.target.closest('.reader-paragraph');
        const headingEl = e.target.closest('#reader-chapter-heading');
        if (paraEl || headingEl) {
          const paraIdx = headingEl ? -1 : parseInt(paraEl.getAttribute('data-para-idx') || '0', 10);
          this.startTTSFromParagraph(paraIdx);
        }
      });

      scrollCanvas.addEventListener('scroll', () => {
        this.hideParaQuickAction();
        this.updateStatusBar();
        clearTimeout(this.scrollSaveDebounce);
        this.scrollSaveDebounce = setTimeout(() => {
          this.saveCurrentProgress();
        }, 500);
      });
    }

    // Reader Back button
    this.on('btn-reader-back', 'click', () => this.closeReader());

    // In-content Prev / Next Chapter Buttons
    this.on('btn-prev-chapter', 'click', () => {
      if (this.currentChapterIndex > 0) {
        this.loadChapter(this.currentChapterIndex - 1, 0);
      } else {
        this.showToast('已經是第一章了');
      }
    });

    this.on('btn-next-chapter', 'click', () => {
      if (this.currentBook && this.currentChapterIndex < this.currentBook.chapters.length - 1) {
        this.loadChapter(this.currentChapterIndex + 1, 0);
      } else {
        this.showToast('已經讀到最後一章了');
      }
    });

    // Progress slider change
    const slider = document.getElementById('reader-progress-slider');
    if (slider) {
      slider.addEventListener('change', (e) => {
        const idx = parseInt(e.target.value, 10);
        this.loadChapter(idx, 0);
      });
    }

    this.on('btn-slider-prev', 'click', () => {
      if (this.currentChapterIndex > 0) this.loadChapter(this.currentChapterIndex - 1, 0);
    });

    this.on('btn-slider-next', 'click', () => {
      if (this.currentBook && this.currentChapterIndex < this.currentBook.chapters.length - 1) {
        this.loadChapter(this.currentChapterIndex + 1, 0);
      }
    });

    // Reader TOC drawer buttons
    this.on('btn-tool-toc', 'click', () => this.openTOC());
    this.on('btn-reader-toc-inline', 'click', () => this.openTOC());
    this.on('btn-close-toc', 'click', () => this.closeTOC());
    this.on('toc-drawer-overlay', 'click', (e) => {
      if (e.target.id === 'toc-drawer-overlay') this.closeTOC();
    });

    // Reader Add/Remove Shelf buttons (Both top bookmark and bottom toolbar)
    this.on('btn-tool-shelf', 'click', () => this.toggleCurrentBookShelf());
    this.on('btn-reader-shelf-top', 'click', () => this.toggleCurrentBookShelf());

    // Reader Settings buttons (Both top Aa and bottom toolbar)
    this.on('btn-tool-settings', 'click', () => this.openSettings());
    this.on('btn-reader-settings-top', 'click', () => this.openSettings());
    this.on('settings-sheet-overlay', 'click', (e) => {
      if (e.target.id === 'settings-sheet-overlay') this.closeSettings();
    });

    // Font size +/- (Reader settings sheet)
    this.on('btn-font-decrease', 'click', () => {
      const s = novelDB.getSettings();
      s.fontSize = Math.max(14, s.fontSize - 1);
      novelDB.saveSettings(s);
      this.applySettings(s);
      this.showToast(`字體已調小至 ${s.fontSize} px`);
    });

    this.on('btn-font-increase', 'click', () => {
      const s = novelDB.getSettings();
      s.fontSize = Math.min(28, s.fontSize + 1);
      novelDB.saveSettings(s);
      this.applySettings(s);
      this.showToast(`字體已調大至 ${s.fontSize} px`);
    });

    // Font size +/- (Profile page)
    this.on('btn-profile-font-minus', 'click', () => {
      const s = novelDB.getSettings();
      s.fontSize = Math.max(14, s.fontSize - 1);
      novelDB.saveSettings(s);
      this.applySettings(s);
      this.showToast(`字體已調小至 ${s.fontSize} px`);
    });

    this.on('btn-profile-font-plus', 'click', () => {
      const s = novelDB.getSettings();
      s.fontSize = Math.min(28, s.fontSize + 1);
      novelDB.saveSettings(s);
      this.applySettings(s);
      this.showToast(`字體已調大至 ${s.fontSize} px`);
    });

    // Theme selector chips (Both reader & profile)
    document.querySelectorAll('.theme-chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const theme = btn.getAttribute('data-theme-val');
        const s = novelDB.getSettings();
        s.theme = theme;
        novelDB.saveSettings(s);
        this.applySettings(s);
        const nameMap = { paper: '米黃羊皮紙', white: '純白雅緻', mint: '護眼豆沙綠', slate: '雅灰夜讀', oled: '極致純黑' };
        this.showToast(`主題已切換為：${nameMap[theme] || theme}`);
      });
    });

    // Font Family selector
    document.querySelectorAll('#font-family-control .segment-item-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const font = btn.getAttribute('data-font');
        const s = novelDB.getSettings();
        s.fontFamily = font;
        novelDB.saveSettings(s);
        this.applySettings(s);
      });
    });

    // Line Spacing selector
    document.querySelectorAll('#line-spacing-control .segment-item-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const spacing = parseFloat(btn.getAttribute('data-spacing'));
        const s = novelDB.getSettings();
        s.lineHeight = spacing;
        novelDB.saveSettings(s);
        this.applySettings(s);
      });
    });

    // Simplified / Traditional Chinese Mode selector (簡繁轉換即時切換)
    document.querySelectorAll('#chinese-mode-control .segment-item-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-chinese-mode');
        const s = novelDB.getSettings();
        s.chineseMode = mode;
        novelDB.saveSettings(s);
        this.applySettings(s);
        if (this.currentBook) {
          this.loadChapter(this.currentChapterIndex, 0);
          this.renderTOC();
        }
        this.renderBookshelf();
        this.showToast(mode === 's2t' ? '🔤 已切換為：繁體正體' : '🔤 已切換為：原文簡體');
      });
    });

    // AI Audio Listening Mode (聽書)
    this.on('btn-reader-cache-top', 'click', () => this.cacheCurrentBookChapters());
    this.on('btn-reader-audio', 'click', () => this.openAudioSheet());
    this.on('btn-tool-audio', 'click', () => this.openAudioSheet());
    this.on('audio-mini-pill', 'click', (e) => {
      if (e.target.closest('#btn-mini-play-toggle')) return;
      this.openAudioSheet();
    });

    this.on('btn-close-audio-sheet', 'click', () => this.closeAudioSheet());
    this.on('audio-player-modal', 'click', (e) => {
      if (e.target.id === 'audio-player-modal') this.closeAudioSheet();
    });

    // Mini pill play/pause toggle
    this.on('btn-mini-play-toggle', 'click', (e) => {
      e.stopPropagation();
      if (novelTTS.isPlaying && !novelTTS.isPaused) {
        novelTTS.pause();
      } else {
        novelTTS.play();
      }
    });

    // Main Audio Sheet controls
    this.on('btn-audio-play-main', 'click', () => {
      if (novelTTS.isPlaying && !novelTTS.isPaused) {
        novelTTS.pause();
      } else {
        novelTTS.play();
      }
    });

    this.on('btn-audio-prev-para', 'click', () => novelTTS.prevParagraph());
    this.on('btn-audio-next-para', 'click', () => novelTTS.nextParagraph());

    // Floating Paragraph Quick Read Pill
    this.on('btn-para-start-read', 'click', (e) => {
      e.stopPropagation();
      if (typeof this.selectedParaIdx === 'number') {
        this.startTTSFromParagraph(this.selectedParaIdx);
      }
    });

    // Local Server Sync (192.168.0.114:3001)
    this.on('btn-header-sync', 'click', () => this.syncWithLocalServer(false));
    this.on('btn-sync-now', 'click', () => this.syncWithLocalServer(false));

    // Voice picker modal triggers
    this.on('btn-audio-voice-pick', 'click', () => this.openVoicePicker());
    this.on('btn-profile-voice', 'click', () => this.openVoicePicker());
    this.on('btn-close-voice-modal', 'click', () => this.closeVoicePicker());
    this.on('voice-picker-modal', 'click', (e) => {
      if (e.target.id === 'voice-picker-modal') this.closeVoicePicker();
    });

    // Speed toggle
    const speeds = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
    let speedIdx = 1;
    this.on('btn-audio-speed-pick', 'click', () => {
      speedIdx = (speedIdx + 1) % speeds.length;
      const rate = speeds[speedIdx];
      novelTTS.setRate(rate);
      const label = document.getElementById('label-audio-speed');
      if (label) label.textContent = `${rate}x 語速`;
      this.showToast(`聽書語速已設定為 ${rate}x`);
    });

    // Sleep Timer modal & controls (微信讀書專屬定時關閉全功能綁定)
    this.on('btn-audio-timer-pick', 'click', () => this.openTimerModal());
    this.on('audio-timer-banner', 'click', () => this.openTimerModal());
    this.on('status-bar-timer', 'click', () => this.openTimerModal());
    this.on('btn-reader-timer', 'click', () => this.openTimerModal());
    this.on('mini-pill-timer', 'click', () => this.openTimerModal());

    this.on('btn-close-timer-modal', 'click', () => {
      const modal = document.getElementById('timer-picker-modal');
      if (modal) modal.classList.remove('active');
    });

    this.on('timer-picker-modal', 'click', (e) => {
      if (e.target.id === 'timer-picker-modal') {
        e.target.classList.remove('active');
      }
    });

    // Preset timer buttons (15分, 30分, 45分, 60分, 90分, 120分, 讀完本章)
    document.querySelectorAll('.timer-choice').forEach(choice => {
      choice.addEventListener('click', () => {
        const val = choice.getAttribute('data-timer');
        novelTTS.setSleepTimer(val);
        const status = novelTTS.getSleepTimerStatus();
        this.updateSleepTimerUI(status.formatted, status.remainingSeconds, status.type);
        this.showToast(val === 'chapter' ? '⏱️ 已設定定時：讀完本章後停止' : `⏱️ 已設定定時關閉：${val} 分鐘（倒計時已啟動）`);
      });
    });

    // Custom minutes stepper (+ / - / input)
    const customInput = document.getElementById('input-custom-timer');
    this.on('btn-timer-minus', 'click', () => {
      if (!customInput) return;
      let val = parseInt(customInput.value, 10) || 20;
      val = Math.max(1, val - 5);
      customInput.value = val;
    });

    this.on('btn-timer-plus', 'click', () => {
      if (!customInput) return;
      let val = parseInt(customInput.value, 10) || 20;
      val = Math.min(300, val + 5);
      customInput.value = val;
    });

    this.on('btn-apply-custom-timer', 'click', () => {
      if (!customInput) return;
      const mins = parseInt(customInput.value, 10);
      if (!mins || mins <= 0) {
        this.showToast('請輸入大於 0 的定時分鐘數');
        return;
      }
      novelTTS.setSleepTimer(mins);
      const status = novelTTS.getSleepTimerStatus();
      this.updateSleepTimerUI(status.formatted, status.remainingSeconds, status.type);
      this.showToast(`⏱️ 已設定定時關閉：${mins} 分鐘（倒計時已啟動）`);
    });

    // Quick cancel button in timer modal
    this.on('btn-cancel-timer-quick', 'click', () => {
      novelTTS.clearSleepTimer();
      this.updateSleepTimerUI(null, 0, null);
      this.showToast('⏱️ 已關閉定時');
    });

    // Toggle Bookshelf Management Mode
    this.on('btn-manage-shelf', 'click', () => {
      this.isManageMode = !this.isManageMode;
      const btn = document.getElementById('btn-manage-shelf');
      if (btn) {
        if (this.isManageMode) {
          btn.classList.add('active');
          btn.innerHTML = `
            <svg style="width: 13px; height: 13px; margin-right: 3px; vertical-align: -2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            完成管理
          `;
          this.showToast('🛠️ 已進入書架管理模式，點擊任一書籍右上角 ✕ 即可移出書架');
        } else {
          btn.classList.remove('active');
          btn.innerHTML = `
            <svg style="width: 13px; height: 13px; margin-right: 3px; vertical-align: -2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
            管理書架
          `;
        }
      }
      this.renderBookshelf();
    });

    // Import Local Books (PDF, TXT, EPUB, MD)
    const fileInput = document.getElementById('file-import-input') || document.getElementById('input-txt-file');
    const handleFiles = async (files) => {
      if (!files || files.length === 0) return;
      for (const file of files) {
        try {
          this.showToast(`正在智慧解析《${file.name}》...`);
          const book = await novelSources.parseLocalBook(file);
          novelDB.addToShelf(book);
          await novelDB.saveChapters(book.id, book.chapters);
          this.renderBookshelf();
          this.showToast(`《${book.title}》已成功匯入（共 ${book.chapters.length} 章），已加入書架！`);
          this.openBook(book.id);
        } catch (err) {
          alert(`解析《${file.name}》失敗: ` + err.message);
        }
      }
      if (fileInput) fileInput.value = '';
    };

    this.on('btn-import-book', 'click', () => {
      if (fileInput) fileInput.click();
    });
    this.on('btn-import-txt', 'click', () => {
      if (fileInput) fileInput.click();
    });

    if (fileInput) {
      fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
    }

    // Drag and drop onto Bookshelf
    const shelfGrid = document.getElementById('shelf-books-grid');
    if (shelfGrid) {
      shelfGrid.addEventListener('dragover', (e) => {
        e.preventDefault();
        shelfGrid.classList.add('drag-over');
      });
      shelfGrid.addEventListener('dragleave', () => {
        shelfGrid.classList.remove('drag-over');
      });
      shelfGrid.addEventListener('drop', (e) => {
        e.preventDefault();
        shelfGrid.classList.remove('drag-over');
        if (e.dataTransfer && e.dataTransfer.files) {
          handleFiles(e.dataTransfer.files);
        }
      });
    }

    // Open Paste URL Modal triggers (Header +, Bookshelf button, Profile button)
    const openPasteUrlModal = () => {
      const modal = document.getElementById('modal-paste-url');
      if (modal) modal.classList.add('active');
      const input = document.getElementById('input-novel-url');
      if (input) input.focus();
    };

    this.on('btn-add-menu', 'click', openPasteUrlModal);
    this.on('btn-shelf-paste-url', 'click', openPasteUrlModal);
    this.on('btn-profile-url', 'click', openPasteUrlModal);
    this.on('btn-close-url-modal', 'click', () => {
      const modal = document.getElementById('modal-paste-url');
      if (modal) modal.classList.remove('active');
    });

    // Sample URL chips click
    document.querySelectorAll('.sample-url-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const url = chip.getAttribute('data-url');
        const input = document.getElementById('input-novel-url');
        if (input) input.value = url;
      });
    });

    // Confirm URL or Novel Name Parse
    this.on('btn-confirm-url', 'click', async () => {
      const input = document.getElementById('input-novel-url');
      const val = input ? input.value.trim() : '';
      if (!val) return alert('請先輸入小說書名或貼上免費小說網址');

      // Case 1: User pasted a URL from sites with Cloudflare protection (twkan.com, look.thisiscm.com, novel543.com, 69shu)
      if (val.includes('twkan') || val.includes('look.thisiscm.com') || val.includes('novel543.com') || val.includes('thisiscm') || val.includes('69shu')) {
        let siteName = '目標小說網站';
        if (val.includes('twkan')) siteName = '台灣小說網 (twkan.com)';
        else if (val.includes('thisiscm')) siteName = '稷下書院';
        else if (val.includes('novel543')) siteName = '543小說網';
        else if (val.includes('69shu')) siteName = '69書吧';

        let bookName = '';
        const slugMatch = val.match(/(?:book|novel|read|art)\/([^/?#]+)/i);
        if (slugMatch && isNaN(slugMatch[1])) {
          bookName = decodeURIComponent(slugMatch[1]);
        }

        if (!bookName) {
          bookName = prompt(`💡「${siteName}」啟用了 Cloudflare 人機驗證防爬蟲保護。\n請輸入您想閱讀的【小說名稱】（例如：凡人修仙傳、劍來、雪中悍刀行、萬相之王等），系統將為您免驗證全網檢索正文：`, '');
        }

        if (bookName && bookName.trim()) {
          this.showToast(`正在為您全網搜尋《${bookName.trim()}》免驗證書源...`);
          try {
            const searchResults = await novelSources.search(bookName.trim());
            if (searchResults && searchResults.length > 0) {
              const chosen = searchResults[0];
              novelDB.addToShelf(chosen);
              const modal = document.getElementById('modal-paste-url');
              if (modal) modal.classList.remove('active');
              this.renderBookshelf();
              this.showToast(`《${chosen.title}》已為您免驗證全網搜尋並成功加入書架！`);
              this.openBook(chosen.id);
              return;
            } else {
              return alert(`全網暫未搜尋到《${bookName}》，請確認書名是否正確。`);
            }
          } catch (e) {
            return alert('搜尋失敗: ' + e.message);
          }
        } else {
          return;
        }
      }

      // Case 2: User typed a novel name directly (not starting with http:// or https://)
      if (!val.startsWith('http://') && !val.startsWith('https://')) {
        try {
          this.showToast(`正在全網搜尋小說《${val}》...`);
          const searchResults = await novelSources.search(val);
          if (searchResults && searchResults.length > 0) {
            const chosen = searchResults[0];
            novelDB.addToShelf(chosen);
            const modal = document.getElementById('modal-paste-url');
            if (modal) modal.classList.remove('active');
            this.renderBookshelf();
            this.showToast(`《${chosen.title}》已加入書架！`);
            this.openBook(chosen.id);
            return;
          } else {
            return alert(`全網未搜尋到《${val}》，您可以切換至「發現」分頁搜尋更多關鍵字。`);
          }
        } catch (err) {
          return alert('搜尋失敗: ' + err.message);
        }
      }

      // Case 3: Standard direct novel URL parsing
      try {
        this.showToast('正在向遠端書源解析全本書籍與完整目錄...');
        const bookId = 'web_' + Date.now();
        const catalog = await novelSources.getBookDetails(bookId, val);
        catalog.id = bookId;
        catalog.detailUrl = val;
        novelDB.addToShelf(catalog);
        const modal = document.getElementById('modal-paste-url');
        if (modal) modal.classList.remove('active');
        this.renderBookshelf();
        const totalCount = catalog.chapters ? catalog.chapters.length : 1;
        this.showToast(`《${catalog.title}》解析成功（全本共 ${totalCount} 章），已加入書架！`);
        this.openBook(bookId, catalog.initialIndex || 0);
      } catch (err) {
        const titlePrompt = prompt(`該網站因伺服器防爬蟲保護無法直接抓取 (${err.message})。\n請輸入該小說的【書名】，系統將立即為您免驗證全網搜尋：`, '');
        if (titlePrompt && titlePrompt.trim()) {
          this.showToast(`正在為您全網搜尋《${titlePrompt.trim()}》免驗證書源...`);
          try {
            const results = await novelSources.search(titlePrompt.trim());
            if (results && results.length > 0) {
              const chosen = results[0];
              novelDB.addToShelf(chosen);
              const modal = document.getElementById('modal-paste-url');
              if (modal) modal.classList.remove('active');
              this.renderBookshelf();
              this.showToast(`《${chosen.title}》已加入書架！`);
              this.openBook(chosen.id);
            } else {
              alert(`全網未找到《${titlePrompt}》，您可以到「發現」分頁搜尋更多關鍵字。`);
            }
          } catch (searchErr) {
            alert('搜尋失敗: ' + searchErr.message);
          }
        }
      }
    });

    // Clear cache
    this.on('btn-clear-cache', 'click', () => {
      if (confirm('確定要清空本機快取與閱讀紀錄嗎？')) {
        localStorage.clear();
        location.reload();
      }
    });

    // Bookshelf Backup Export
    this.on('btn-export-backup', 'click', () => {
      try {
        const shelf = novelDB.getBookshelf();
        const progress = novelDB.getAllProgress();
        const settings = novelDB.getSettings();
        const backupData = {
          version: '1.0',
          exportedAt: new Date().toISOString(),
          shelf,
          progress,
          settings
        };
        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `墨韻讀書_書架備份_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('書架備份檔案已成功下載！');
      } catch (err) {
        alert('匯出失敗: ' + err.message);
      }
    });

    // Bookshelf Backup Import
    const backupInput = document.getElementById('input-backup-file');
    this.on('btn-import-backup', 'click', () => {
      if (backupInput) backupInput.click();
    });

    if (backupInput) {
      backupInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          if (Array.isArray(data.shelf)) {
            novelDB.saveBookshelf(data.shelf);
          }
          if (data.progress) {
            localStorage.setItem(novelDB.STORAGE_PROGRESS_KEY, JSON.stringify(data.progress));
          }
          if (data.settings) {
            novelDB.saveSettings(data.settings);
          }
          this.renderBookshelf();
          this.showToast('🎉 書架與進度已成功同步還原！');
        } catch (err) {
          alert('備份檔案解析失敗: ' + err.message);
        }
        backupInput.value = '';
      });
    }

    // Backend API Server Configuration
    const updateApiStatusUI = () => {
      const statusEl = document.getElementById('profile-api-status');
      const current = localStorage.getItem('wr_api_base');
      if (statusEl) {
        if (current && current.trim()) {
          statusEl.textContent = `自訂雲端: ${current.trim()}`;
          statusEl.style.color = 'var(--wr-primary)';
        } else if (location.hostname.includes('github.io')) {
          statusEl.textContent = '靜態網站模式（可點選設定雲端後端）';
          statusEl.style.color = '#eab308';
        } else {
          statusEl.textContent = '預設同源模式';
          statusEl.style.color = 'var(--wr-text-secondary)';
        }
      }
    };
    updateApiStatusUI();

    this.on('btn-profile-api', 'click', () => {
      const modal = document.getElementById('modal-api-server');
      const input = document.getElementById('input-api-url');
      if (input) {
        input.value = localStorage.getItem('wr_api_base') || '';
      }
      if (modal) modal.classList.add('active');
    });

    this.on('btn-close-api-modal', 'click', () => {
      const modal = document.getElementById('modal-api-server');
      if (modal) modal.classList.remove('active');
    });

    this.on('btn-save-api-url', 'click', () => {
      const input = document.getElementById('input-api-url');
      const val = input ? input.value.trim() : '';
      if (val) {
        let clean = val.replace(/\/+$/, '');
        if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
          clean = 'https://' + clean;
        }
        localStorage.setItem('wr_api_base', clean);
        this.showToast('後端伺服器網址已更新！');
      } else {
        localStorage.removeItem('wr_api_base');
        this.showToast('已重設為預設模式');
      }
      const modal = document.getElementById('modal-api-server');
      if (modal) modal.classList.remove('active');
      updateApiStatusUI();
    });

    this.on('btn-reset-api-url', 'click', () => {
      localStorage.removeItem('wr_api_base');
      const input = document.getElementById('input-api-url');
      if (input) input.value = '';
      this.showToast('已重設為預設模式');
      const modal = document.getElementById('modal-api-server');
      if (modal) modal.classList.remove('active');
      updateApiStatusUI();
    });

    // Mobile Connect & Cross-Device Sync Modal Triggers
    const openMobileModal = async () => {
      const modal = document.getElementById('modal-mobile-connect');
      if (!modal) return;
      modal.classList.add('active');

      try {
        const apiBase = novelSources.getApiBaseUrl();
        const res = await fetch(`${apiBase}/api/status`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.ips && data.ips.length > 0) {
            const wifi = data.ips.find(i => i.isWifi) || data.ips[0];
            const eth = data.ips.find(i => !i.isWifi) || data.ips[1] || wifi;

            const wifiUrl = wifi.url;
            const ethUrl = eth.url;

            const wifiEl = document.getElementById('mobile-url-wifi');
            if (wifiEl) wifiEl.textContent = wifiUrl;

            const ethEl = document.getElementById('mobile-url-eth');
            if (ethEl) ethEl.textContent = ethUrl;

            const qrImg = document.getElementById('mobile-qr-code-img');
            if (qrImg) {
              qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(wifiUrl)}`;
            }
          }
        }
      } catch (err) {
        console.warn('Fetch server status for mobile modal notice:', err);
      }
    };

    this.on('btn-header-mobile', 'click', () => openMobileModal());
    this.on('card-sync-status', 'click', () => openMobileModal());
    this.on('btn-close-mobile-modal', 'click', () => {
      const modal = document.getElementById('modal-mobile-connect');
      if (modal) modal.classList.remove('active');
    });
    this.on('modal-mobile-connect', 'click', (e) => {
      if (e.target.id === 'modal-mobile-connect') {
        e.target.classList.remove('active');
      }
    });

    // Copy LAN URL button inside mobile modal
    document.querySelectorAll('.btn-copy-url').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const targetEl = document.getElementById(targetId);
        const text = targetEl ? targetEl.textContent.trim() : '';
        if (text) {
          navigator.clipboard.writeText(text).then(() => {
            this.showToast(`✓ 已複製網址: ${text}`);
          }).catch(() => {
            prompt('請手動選取複製網址：', text);
          });
        }
      });
    });
  }

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

// Start App on DOM Ready
window.addEventListener('DOMContentLoaded', () => {
  window.novelApp = new NovelApp();
});

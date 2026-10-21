/**
 * AI Audio Novel Engine (微信讀書 AI 聽書同款)
 * Multi-voice Web Speech Synthesis with dedicated Male/Female profiles, sleep timer & waveform visualizer
 */

class NovelTTSEngine {
  constructor() {
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.systemVoices = [];
    this.currentVoice = null;
    this.currentProfile = null;
    this.rate = 1.0;
    this.pitch = 1.0;
    this.isPlaying = false;
    this.isPaused = false;

    this.paragraphs = [];
    this.currentParaIndex = 0;
    this.currentUtterance = null;

    // Sleep timer
    this.sleepTimerId = null;
    this.sleepRemainingSeconds = 0;
    this.stopAtChapterEnd = false;

    // Listeners for UI
    this.onParagraphChange = null;
    this.onStateChange = null;
    this.onChapterFinished = null;
    this.onSleepTick = null;

    this.initVoices();
  }

  initVoices() {
    if (!this.synth) return;

    const refresh = () => {
      try {
        const all = this.synth.getVoices() || [];
        this.systemVoices = all;
        if (!this.currentVoice && all.length > 0) {
          // Default to male or natural voice if possible
          const maleVoice = all.find(v => 
            v.name.includes('Zhiwei') || 
            v.name.includes('Yunxi') || 
            v.name.includes('Yunyang') || 
            v.name.includes('Yunjian') ||
            v.name.includes('YunJhe')
          );
          const zhVoice = all.find(v => v.lang.startsWith('zh'));
          this.currentVoice = maleVoice || zhVoice || all[0];
        }
      } catch (e) {
        console.warn('Voice load warning:', e);
      }
    };

    refresh();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = refresh;
    }
  }

  // Curated Voice List with explicit Male and Female categories
  getVoiceList() {
    if (this.synth) {
      const all = this.synth.getVoices() || [];
      if (all.length > 0) this.systemVoices = all;
    }

    const all = this.systemVoices;

    // Helper to find system voice by keywords
    const findVoice = (kws) => {
      return all.find(v => {
        const n = v.name.toLowerCase();
        return kws.some(k => n.includes(k.toLowerCase()));
      });
    };

    // Find actual system voices if installed
    const zhiweiSys = findVoice(['zhiwei', '志偉']);
    const yunxiSys = findVoice(['yunxi', '雲希']);
    const yunjianSys = findVoice(['yunjian', '雲健']);
    const yunyangSys = findVoice(['yunyang', '雲揚']);
    const yunjheSys = findVoice(['yunjhe', '雲哲']);
    const hanhanSys = findVoice(['hanhan', '涵涵']);
    const yatingSys = findVoice(['yating', '雅婷']);
    const xiaoxiaoSys = findVoice(['xiaoxiao', '曉曉']);
    const generalZh = all.find(v => v.lang.startsWith('zh')) || all[0];

    // Curated Profiles: Purely type-based without fictional names or duplicate male voices
    const profiles = [
      // 1. 男聲 (單一真實男聲，沉穩厚重)
      {
        id: 'voice_male_deep',
        gender: 'male',
        name: '沉穩男聲',
        tag: '厚重沉穩 · 適合玄幻、歷史、修仙與長篇小說',
        icon: '🎙️',
        pitch: 0.82,
        rateModifier: 0.98,
        sampleText: '歡迎收聽小說朗讀，為您帶來沉穩流暢的演播體驗。',
        matchedVoice: zhiweiSys || yunjheSys || yunxiSys || generalZh
      },

      // 2. 溫柔女聲
      {
        id: 'voice_female_soft',
        gender: 'female',
        name: '溫柔女聲',
        tag: '清麗柔和 · 適合現代、言情與生活日常小說',
        icon: '🌸',
        pitch: 1.05,
        rateModifier: 1.0,
        sampleText: '歡迎收聽小說朗讀，讓柔和溫暖的聲音陪伴您的閱讀時光。',
        matchedVoice: yatingSys || hanhanSys || generalZh
      },

      // 3. 清晰女聲
      {
        id: 'voice_female_clear',
        gender: 'female',
        name: '清晰女聲',
        tag: '標準自然 · 適合各類文學、都市與敘事作品',
        icon: '✨',
        pitch: 1.0,
        rateModifier: 1.0,
        sampleText: '歡迎收聽小說朗讀，為您提供清晰自然的小說朗讀服務。',
        matchedVoice: hanhanSys || xiaoxiaoSys || generalZh
      },

      // 4. 系統預設語音
      {
        id: 'voice_system_default',
        gender: 'system',
        name: '系統預設語音',
        tag: '使用您裝置目前的標準預設朗讀聲音',
        icon: '💻',
        pitch: 1.0,
        rateModifier: 1.0,
        sampleText: '正在使用您的裝置系統預設語音進行試聽。',
        matchedVoice: generalZh || all[0]
      }
    ];

    // Format list
    return profiles.map((p, idx) => ({
      index: idx,
      id: p.id,
      name: p.name,
      gender: p.gender,
      tag: p.tag,
      icon: p.icon,
      pitch: p.pitch,
      rateModifier: p.rateModifier,
      sampleText: p.sampleText,
      matchedVoice: p.matchedVoice,
      isSelected: this.currentProfile?.id === p.id || (!this.currentProfile && idx === 0)
    }));
  }

  // Select voice profile
  setVoiceByIndex(index) {
    const list = this.getVoiceList();
    const item = list[index];
    if (!item) return;

    this.currentProfile = item;
    if (item.matchedVoice) {
      this.currentVoice = item.matchedVoice;
    }
    this.pitch = item.pitch;

    if (this.isPlaying && !this.isPaused) {
      this.synth.cancel();
      this.speakCurrentParagraph();
    }

    if (this.onStateChange) this.onStateChange();
  }

  // Preview voice sample with real audio utterance
  previewVoice(index) {
    if (!this.synth) return;
    this.synth.cancel();

    const list = this.getVoiceList();
    const item = list[index];
    if (!item) return;

    const utter = new SpeechSynthesisUtterance(item.sampleText);
    if (item.matchedVoice) {
      utter.voice = item.matchedVoice;
    }
    utter.pitch = item.pitch || 1.0;
    utter.rate = this.rate * (item.rateModifier || 1.0);
    utter.lang = item.matchedVoice ? item.matchedVoice.lang : 'zh-TW';

    this.synth.speak(utter);
  }

  // Set speed
  setRate(rate) {
    this.rate = Math.max(0.5, Math.min(2.5, rate));
    if (this.isPlaying && !this.isPaused) {
      this.synth.cancel();
      this.speakCurrentParagraph();
    }
  }

  // Load chapter text
  loadText(chapterTitle, textContent, startIndex = 0) {
    this.stop();
    const cleanTitle = typeof ChineseConv !== 'undefined' && ChineseConv.decodePua ? ChineseConv.decodePua(chapterTitle || '') : (chapterTitle || '');
    const cleanBody = typeof ChineseConv !== 'undefined' && ChineseConv.decodePua ? ChineseConv.decodePua(textContent || '') : (textContent || '');
    const rawLines = cleanBody.split(/\r?\n+/);
    const cleaned = [];

    if (cleanTitle) {
      const t = cleanTitle.replace(/[\uE000-\uF8FF\uFFF0-\uFFFF]/g, '').trim();
      if (t) cleaned.push(t);
    }

    for (const line of rawLines) {
      const trimmed = line.replace(/[\uE000-\uF8FF\uFFF0-\uFFFF]/g, '').trim();
      if (trimmed.length > 0) {
        if (trimmed.length > 250) {
          const sentences = trimmed.match(/[^。！？…]+[。！？…]?/g) || [trimmed];
          cleaned.push(...sentences.map(s => s.trim()).filter(Boolean));
        } else {
          cleaned.push(trimmed);
        }
      }
    }

    this.paragraphs = cleaned;
    this.currentParaIndex = Math.min(startIndex, Math.max(0, cleaned.length - 1));
  }

  play() {
    if (!this.synth) {
      alert('您的瀏覽器不支援語音合成聽書');
      return;
    }

    if (this.isPaused) {
      this.isPaused = false;
      this.isPlaying = true;
      this.synth.resume();
      if (this.onStateChange) this.onStateChange();
      return;
    }

    if (this.paragraphs.length === 0) return;

    this.isPlaying = true;
    this.isPaused = false;
    this.speakCurrentParagraph();
    if (this.onStateChange) this.onStateChange();
  }

  pause() {
    if (this.isPlaying && !this.isPaused) {
      this.isPaused = true;
      this.synth.pause();
      if (this.onStateChange) this.onStateChange();
    }
  }

  stop() {
    this.isPlaying = false;
    this.isPaused = false;
    if (this.synth) {
      this.synth.cancel();
    }
    if (this.onStateChange) this.onStateChange();
  }

  speakCurrentParagraph() {
    if (!this.isPlaying) return;

    if (this.currentParaIndex >= this.paragraphs.length) {
      this.stop();
      if (this.stopAtChapterEnd) {
        this.clearSleepTimer();
        return;
      }
      if (this.onChapterFinished) {
        this.onChapterFinished();
      }
      return;
    }

    let text = this.paragraphs[this.currentParaIndex];
    if (typeof ChineseConv !== 'undefined' && ChineseConv.decodePua) {
      text = ChineseConv.decodePua(text);
    }
    text = (text || '').replace(/[\uE000-\uF8FF\uFFF0-\uFFFF]/g, '').trim();

    if (!text || text.length === 0) {
      this.currentParaIndex++;
      this.speakCurrentParagraph();
      return;
    }

    this.synth.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    if (this.currentVoice) {
      utter.voice = this.currentVoice;
    }

    let actualRate = this.rate;
    let actualPitch = this.pitch;
    if (this.currentProfile) {
      actualRate *= (this.currentProfile.rateModifier || 1.0);
      actualPitch = this.currentProfile.pitch || 1.0;
    }

    utter.rate = actualRate;
    utter.pitch = actualPitch;
    utter.lang = this.currentVoice ? this.currentVoice.lang : 'zh-TW';

    utter.onstart = () => {
      if (this.onParagraphChange) {
        this.onParagraphChange(this.currentParaIndex, text);
      }
    };

    utter.onend = () => {
      if (this.isPlaying && !this.isPaused) {
        this.currentParaIndex++;
        setTimeout(() => {
          if (this.isPlaying && !this.isPaused) {
            this.speakCurrentParagraph();
          }
        }, 160);
      }
    };

    utter.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        console.warn('TTS error:', e.error);
        if (this.isPlaying) {
          this.currentParaIndex++;
          this.speakCurrentParagraph();
        }
      }
    };

    this.currentUtterance = utter;
    this.synth.speak(utter);
  }

  jumpToParagraph(index) {
    if (index >= 0 && index < this.paragraphs.length) {
      this.currentParaIndex = index;
      if (this.isPlaying) {
        this.synth.cancel();
        this.speakCurrentParagraph();
      } else {
        if (this.onParagraphChange) {
          this.onParagraphChange(this.currentParaIndex, this.paragraphs[this.currentParaIndex]);
        }
      }
    }
  }

  nextParagraph() {
    if (this.currentParaIndex < this.paragraphs.length - 1) {
      this.jumpToParagraph(this.currentParaIndex + 1);
    }
  }

  prevParagraph() {
    if (this.currentParaIndex > 0) {
      this.jumpToParagraph(this.currentParaIndex - 1);
    }
  }

  // Sleep Timer (Minutes: 15, 30, 45, 60, custom, or 'chapter')
  setSleepTimer(minutes) {
    this.clearSleepTimer();

    if (minutes === 'chapter') {
      this.stopAtChapterEnd = true;
      this.activeTimerType = 'chapter';
      this.sleepRemainingSeconds = 0;
      if (this.onSleepTick) this.onSleepTick('讀完本章停止', 0, 'chapter');
      return;
    }

    const mins = parseInt(minutes, 10);
    if (!mins || mins <= 0) {
      this.activeTimerType = null;
      if (this.onSleepTick) this.onSleepTick(null, 0, null);
      return;
    }

    this.stopAtChapterEnd = false;
    this.activeTimerType = mins;
    this.sleepRemainingSeconds = mins * 60;

    const format = (sec) => {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    // Immediately trigger tick so UI gets live countdown numbers at 0th second
    if (this.onSleepTick) this.onSleepTick(format(this.sleepRemainingSeconds), this.sleepRemainingSeconds, mins);

    const tick = () => {
      if (this.sleepRemainingSeconds <= 0) {
        this.stop();
        this.clearSleepTimer();
        if (this.onSleepTick) this.onSleepTick(null, 0, null);
        return;
      }

      this.sleepRemainingSeconds--;
      if (this.onSleepTick) this.onSleepTick(format(this.sleepRemainingSeconds), this.sleepRemainingSeconds, mins);

      this.sleepTimerId = setTimeout(tick, 1000);
    };

    this.sleepTimerId = setTimeout(tick, 1000);
  }

  getSleepTimerStatus() {
    const format = (sec) => {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const isActive = (this.sleepRemainingSeconds > 0) || this.stopAtChapterEnd;
    let formatted = null;
    if (this.stopAtChapterEnd) {
      formatted = '讀完本章停止';
    } else if (this.sleepRemainingSeconds > 0) {
      formatted = format(this.sleepRemainingSeconds);
    }

    return {
      isActive,
      remainingSeconds: this.sleepRemainingSeconds,
      stopAtChapterEnd: this.stopAtChapterEnd,
      type: this.activeTimerType,
      formatted
    };
  }

  clearSleepTimer() {
    if (this.sleepTimerId) {
      clearTimeout(this.sleepTimerId);
      this.sleepTimerId = null;
    }
    this.sleepRemainingSeconds = 0;
    this.stopAtChapterEnd = false;
    this.activeTimerType = null;
    if (this.onSleepTick) this.onSleepTick(null, 0, null);
  }
}

window.novelTTS = new NovelTTSEngine();

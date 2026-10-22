/**
 * AI Audio Novel Engine (微信讀書 AI 聽書同款 - 真人多音色增強版)
 * Real Multi-voice Web Speech Synthesis with Dynamic Device Voice Discovery,
 * Zero-distortion 1.0 pitch, Anti-crackle paragraph transitions, and Sleep Timer
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
    this.activeTimerType = null;

    // Listeners for UI
    this.onParagraphChange = null;
    this.onStateChange = null;
    this.onChapterFinished = null;
    this.onSleepTick = null;
    this.onVoicesReady = null;

    this.initVoices();
  }

  initVoices() {
    if (!this.synth) return;

    const refresh = () => {
      try {
        const all = this.synth.getVoices() || [];
        if (all.length > 0) {
          this.systemVoices = all;
          this.restoreSavedVoice();
          if (this.onVoicesReady) this.onVoicesReady();
        }
      } catch (e) {
        console.warn('Voice load warning:', e);
      }
    };

    refresh();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = refresh;
    }
    // Safari iOS / Chrome mobile asynchronous delays
    setTimeout(refresh, 80);
    setTimeout(refresh, 350);
    setTimeout(refresh, 1000);
  }

  restoreSavedVoice() {
    if (!this.systemVoices || this.systemVoices.length === 0) return;

    // 1. Try to restore user saved voice by name
    try {
      const savedName = localStorage.getItem('weread_tts_voice_name');
      if (savedName) {
        const match = this.systemVoices.find(v => v.name === savedName);
        if (match) {
          this.currentVoice = match;
          return;
        }
      }
    } catch (e) {}

    // 2. Default Priority: Taiwan Chinese > Mainland Chinese > Any Chinese > System default
    const isTw = (v) => {
      const l = (v.lang || '').toLowerCase();
      const n = (v.name || '').toLowerCase();
      return l.includes('tw') || n.includes('taiwan') || n.includes('國語') ||
             n.includes('zhiwei') || n.includes('yating') || n.includes('meijia') ||
             n.includes('hsaio') || n.includes('yunjhe');
    };

    const isZh = (v) => {
      const l = (v.lang || '').toLowerCase();
      const n = (v.name || '').toLowerCase();
      return l.startsWith('zh') || l.includes('cmn') || n.includes('chinese');
    };

    const twVoice = this.systemVoices.find(isTw);
    const zhVoice = this.systemVoices.find(isZh);

    this.currentVoice = twVoice || zhVoice || this.systemVoices[0];
  }

  // Get Friendly Display Name of Current Voice
  getCurrentVoiceName() {
    if (this.currentProfile && this.currentProfile.name) {
      return this.currentProfile.name;
    }
    if (this.currentVoice) {
      let name = this.currentVoice.name;
      name = name
        .replace(/Microsoft /i, '')
        .replace(/ Online \(Natural\)/i, '')
        .replace(/ - Chinese \(.*?\)/i, '')
        .replace(/Chinese \(Taiwan\)/i, '臺灣')
        .replace(/Chinese \(China\)/i, '普通話');
      return name;
    }
    return '系統預設聲音';
  }

  // Real Multi-voice List: Discovers every actual voice installed on the user's device
  getVoiceList() {
    if (this.synth) {
      const all = this.synth.getVoices() || [];
      if (all.length > 0) this.systemVoices = all;
    }

    const all = this.systemVoices || [];
    if (all.length === 0) {
      return [{
        index: 0,
        id: 'voice_default',
        name: '系統預設朗讀聲音',
        gender: 'system',
        tag: '正在檢測裝置語音庫...',
        icon: '📱',
        pitch: 1.0,
        rateModifier: 1.0,
        sampleText: '歡迎收聽小說朗讀，為您提供純淨自然的聽書體驗。',
        matchedVoice: null,
        isSelected: true
      }];
    }

    // Filter Chinese voices first
    const isZhVoice = (v) => {
      const l = (v.lang || '').toLowerCase();
      const n = (v.name || '').toLowerCase();
      return l.startsWith('zh') || l.includes('cmn') || l.includes('yue') ||
             n.includes('chinese') || n.includes('taiwan') || n.includes('mandarin') ||
             n.includes('cantonese') || n.includes('國語') || n.includes('普通話') ||
             n.includes('廣東話') || n.includes('粵語') || n.includes('siri') ||
             n.includes('meijia') || n.includes('tingting') || n.includes('sinji') ||
             n.includes('zhiwei') || n.includes('yating') || n.includes('xiaoxiao') ||
             n.includes('yunxi') || n.includes('hanhan') || n.includes('hsaio') ||
             n.includes('yunjhe') || n.includes('yunyang') || n.includes('yunjian');
    };

    let targetVoices = all.filter(isZhVoice);

    // If no Chinese voices found, show all available system voices (up to 8)
    if (targetVoices.length === 0) {
      targetVoices = all.slice(0, 8);
    }

    // Sort: Taiwan voices first, then HK, then Mainland, then others
    targetVoices.sort((a, b) => {
      const aTw = (a.lang || '').toLowerCase().includes('tw') || (a.name || '').toLowerCase().includes('taiwan');
      const bTw = (b.lang || '').toLowerCase().includes('tw') || (b.name || '').toLowerCase().includes('taiwan');
      if (aTw && !bTw) return -1;
      if (!aTw && bTw) return 1;
      return 0;
    });

    // Format each real distinct voice
    return targetVoices.map((v, idx) => {
      const nameLower = (v.name || '').toLowerCase();
      const langLower = (v.lang || '').toLowerCase();

      // Region & Tag
      let regionTag = '🌐 系統標準語音';
      if (langLower.includes('tw') || nameLower.includes('taiwan') || nameLower.includes('國語') || nameLower.includes('傳統') || nameLower.includes('繁體')) {
        regionTag = '🇹🇼 臺灣國語 · 繁體正體';
      } else if (langLower.includes('hk') || nameLower.includes('hong') || nameLower.includes('cantonese') || nameLower.includes('粵語')) {
        regionTag = '🇭🇰 香港粵語';
      } else if (langLower.includes('cn') || nameLower.includes('china') || nameLower.includes('mandarin') || nameLower.includes('普通話')) {
        regionTag = '🇨🇳 標準普通話';
      }

      // Gender & Icon
      let gender = 'system';
      let icon = '✨';
      const isMale = nameLower.includes('zhiwei') || nameLower.includes('yunxi') || nameLower.includes('yunyang') ||
                     nameLower.includes('yunjian') || nameLower.includes('yunjhe') || nameLower.includes('志偉') ||
                     nameLower.includes('雲希') || nameLower.includes('雲哲') || nameLower.includes('男') ||
                     nameLower.includes('male') || nameLower.includes('david') || nameLower.includes('george') || nameLower.includes('mark');

      const isFemale = nameLower.includes('yating') || nameLower.includes('hanhan') || nameLower.includes('xiaoxiao') ||
                       nameLower.includes('meijia') || nameLower.includes('tingting') || nameLower.includes('sinji') ||
                       nameLower.includes('雅婷') || nameLower.includes('涵涵') || nameLower.includes('曉曉') ||
                       nameLower.includes('美佳') || nameLower.includes('婷婷') || nameLower.includes('善怡') ||
                       nameLower.includes('曉臻') || nameLower.includes('hsiaochen') ||
                       nameLower.includes('女') || nameLower.includes('female') || nameLower.includes('zira') || nameLower.includes('karen');

      if (isMale) {
        gender = 'male';
        icon = '🎙️';
      } else if (isFemale) {
        gender = 'female';
        icon = '🌸';
      }

      // Friendly display name
      let displayName = v.name;
      displayName = displayName
        .replace(/Microsoft /i, '')
        .replace(/ Online \(Natural\)/i, ' (自然音色)')
        .replace(/ - Chinese \(.*?\)/i, '')
        .replace(/Chinese \(Taiwan\)/i, '臺灣')
        .replace(/Chinese \(China\)/i, '普通話')
        .replace(/Chinese \(Hong Kong\)/i, '香港');

      const isSelected = this.currentVoice ? (this.currentVoice.name === v.name) : (idx === 0);

      return {
        index: idx,
        id: `voice_${idx}`,
        name: displayName,
        rawName: v.name,
        lang: v.lang,
        gender: gender,
        tag: `${regionTag} · ${v.lang || '本地'}`,
        icon: icon,
        pitch: 1.0, // CRITICAL: Always 1.0 native pitch, eliminating all robotic DSP crackles/破音!
        rateModifier: 1.0,
        sampleText: '歡迎收聽小說朗讀，為您帶來清晰自然、流暢舒適的聽書體驗。',
        matchedVoice: v,
        isSelected: isSelected
      };
    });
  }

  // Select voice profile
  setVoiceByIndex(index) {
    const list = this.getVoiceList();
    const item = list[index];
    if (!item || !item.matchedVoice) return;

    this.currentProfile = item;
    this.currentVoice = item.matchedVoice;
    this.pitch = 1.0; // Strictly 1.0, zero distortion

    // Persist choice
    try {
      localStorage.setItem('weread_tts_voice_name', item.matchedVoice.name);
    } catch (e) {}

    // If currently playing, restart smoothly with new voice
    if (this.isPlaying && !this.isPaused) {
      if (this.synth) this.synth.cancel();
      setTimeout(() => {
        if (this.isPlaying && !this.isPaused) {
          this.speakCurrentParagraph(false);
        }
      }, 50);
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
      utter.lang = item.matchedVoice.lang || 'zh-TW';
    } else {
      utter.lang = 'zh-TW';
    }
    utter.pitch = 1.0; // Clean natural pitch
    utter.rate = this.rate;

    setTimeout(() => {
      this.synth.speak(utter);
    }, 40);
  }

  // Set speed
  setRate(rate) {
    this.rate = Math.max(0.7, Math.min(2.0, rate));
    if (this.isPlaying && !this.isPaused) {
      if (this.synth) this.synth.cancel();
      setTimeout(() => {
        if (this.isPlaying && !this.isPaused) {
          this.speakCurrentParagraph(false);
        }
      }, 50);
    }
  }

  // Load chapter text with intelligent sentence chunking and 100% accurate DOM paragraph mapping
  loadText(chapterTitle, textContent, startIndex = 0) {
    this.stop();
    const cleanTitle = typeof ChineseConv !== 'undefined' && ChineseConv.decodePua ? ChineseConv.decodePua(chapterTitle || '') : (chapterTitle || '');
    const cleanBody = typeof ChineseConv !== 'undefined' && ChineseConv.decodePua ? ChineseConv.decodePua(textContent || '') : (textContent || '');
    const rawLines = cleanBody.split(/\r?\n+/).map(l => l.trim()).filter(Boolean);
    const cleaned = [];

    if (cleanTitle) {
      const t = cleanTitle.replace(/[\uE000-\uF8FF\uFFF0-\uFFFF\u200B-\u200D\uFEFF]/g, '').trim();
      if (t) {
        cleaned.push({
          text: t,
          paraIdx: -1, // -1 denotes chapter heading
          isHeading: true
        });
      }
    }

    rawLines.forEach((line, pIdx) => {
      const trimmed = line.replace(/[\uE000-\uF8FF\uFFF0-\uFFFF\u200B-\u200D\uFEFF]/g, '').trim();
      if (trimmed.length > 0) {
        // Chunk long paragraphs into natural sentences (< 140 chars) to prevent mobile audio buffer clipping
        if (trimmed.length > 140) {
          const sentences = trimmed.match(/[^。！？…]+[。！？…]?/g) || [trimmed];
          sentences.map(s => s.trim()).filter(Boolean).forEach((s) => {
            cleaned.push({
              text: s,
              paraIdx: pIdx,
              isHeading: false
            });
          });
        } else {
          cleaned.push({
            text: trimmed,
            paraIdx: pIdx,
            isHeading: false
          });
        }
      }
    });

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
    this.speakCurrentParagraph(true);
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

  speakCurrentParagraph(forceCancel = false) {
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

    const currentItem = this.paragraphs[this.currentParaIndex];
    let rawText = typeof currentItem === 'object' ? currentItem.text : currentItem;
    const domParaIdx = typeof currentItem === 'object' ? currentItem.paraIdx : this.currentParaIndex;

    if (typeof ChineseConv !== 'undefined' && ChineseConv.decodePua) {
      rawText = ChineseConv.decodePua(rawText);
    }
    // Clean invisible/corrupt characters and replace heavy quotes with natural pauses
    let text = (rawText || '')
      .replace(/[\uE000-\uF8FF\uFFF0-\uFFFF\u200B-\u200D\uFEFF]/g, '')
      .replace(/[「」『』“”""]/g, '，')
      .trim();

    if (!text || text.length === 0) {
      this.currentParaIndex++;
      this.speakCurrentParagraph(false);
      return;
    }

    // Only cancel if forced (jump, speed change, or initial start)
    if (forceCancel && this.synth) {
      this.synth.cancel();
    }

    const utter = new SpeechSynthesisUtterance(text);
    if (this.currentVoice) {
      utter.voice = this.currentVoice;
      utter.lang = this.currentVoice.lang || 'zh-TW';
    } else {
      utter.lang = 'zh-TW';
    }

    utter.rate = Math.max(0.7, Math.min(2.0, this.rate));
    utter.pitch = 1.0; // Strictly 1.0: Zero digital pitch-shift crackle or 破音!

    utter.onstart = () => {
      if (this.onParagraphChange) {
        this.onParagraphChange(this.currentParaIndex, text, domParaIdx);
      }
    };

    utter.onend = () => {
      if (this.isPlaying && !this.isPaused) {
        this.currentParaIndex++;
        // Gentle gap without calling cancel() to prevent hardware audio pops
        setTimeout(() => {
          if (this.isPlaying && !this.isPaused) {
            this.speakCurrentParagraph(false);
          }
        }, 80);
      }
    };

    utter.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        console.warn('TTS error:', e.error);
        if (this.isPlaying) {
          this.currentParaIndex++;
          setTimeout(() => {
            if (this.isPlaying && !this.isPaused) {
              this.speakCurrentParagraph(false);
            }
          }, 80);
        }
      }
    };

    this.currentUtterance = utter;
    this.synth.speak(utter);
  }

  // Jump to specific DOM paragraph index (or -1 for chapter heading)
  jumpToParagraph(targetParaIdx) {
    if (this.paragraphs.length === 0) return;

    let targetAudioIdx = 0;
    if (targetParaIdx === -1) {
      targetAudioIdx = 0;
    } else if (typeof targetParaIdx === 'number') {
      const idx = this.paragraphs.findIndex(p => p.paraIdx === targetParaIdx);
      if (idx !== -1) {
        targetAudioIdx = idx;
      } else {
        // Fallback: closest paragraph
        const closest = this.paragraphs.findIndex(p => p.paraIdx >= targetParaIdx);
        targetAudioIdx = closest !== -1 ? closest : Math.max(0, this.paragraphs.length - 1);
      }
    }

    this.currentParaIndex = targetAudioIdx;
    const currentItem = this.paragraphs[this.currentParaIndex];
    const text = typeof currentItem === 'object' ? currentItem.text : currentItem;
    const domParaIdx = typeof currentItem === 'object' ? currentItem.paraIdx : this.currentParaIndex;

    if (this.isPlaying) {
      this.speakCurrentParagraph(true);
    } else {
      if (this.onParagraphChange) {
        this.onParagraphChange(this.currentParaIndex, text, domParaIdx);
      }
    }
  }

  // Jump to audio sentence item directly
  jumpToAudioIndex(index) {
    if (index >= 0 && index < this.paragraphs.length) {
      this.currentParaIndex = index;
      const currentItem = this.paragraphs[this.currentParaIndex];
      const text = typeof currentItem === 'object' ? currentItem.text : currentItem;
      const domParaIdx = typeof currentItem === 'object' ? currentItem.paraIdx : this.currentParaIndex;

      if (this.isPlaying) {
        this.speakCurrentParagraph(true);
      } else {
        if (this.onParagraphChange) {
          this.onParagraphChange(this.currentParaIndex, text, domParaIdx);
        }
      }
    }
  }

  getCurrentDomParaIndex() {
    if (this.currentParaIndex >= 0 && this.currentParaIndex < this.paragraphs.length) {
      const item = this.paragraphs[this.currentParaIndex];
      return typeof item === 'object' ? item.paraIdx : this.currentParaIndex;
    }
    return 0;
  }

  nextParagraph() {
    const curDom = this.getCurrentDomParaIndex();
    this.jumpToParagraph(curDom + 1);
  }

  prevParagraph() {
    const curDom = this.getCurrentDomParaIndex();
    this.jumpToParagraph(Math.max(-1, curDom - 1));
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

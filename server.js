const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');
const zlib = require('zlib');

const PORT = process.env.PORT || 3001;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const ChineseConv = require('./js/chinese_conv.js');

// Helper: HTTP GET with redirect support, automatic GBK/GB2312/GB18030/UTF-8 detection and decompression
function fetchUrl(targetUrl, timeout = 8000) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(targetUrl);
      const client = parsed.protocol === 'https:' ? https : http;
      
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,zh-TW;q=0.8,en;q=0.7',
          'Accept-Encoding': 'gzip, deflate'
        },
        timeout: timeout
      };

      const req = client.request(options, (res) => {
        // Handle Redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, targetUrl).href;
          return resolve(fetchUrl(redirectUrl, timeout));
        }

        let stream = res;
        const encoding = res.headers['content-encoding'];
        if (encoding === 'gzip') {
          stream = res.pipe(zlib.createGunzip());
        } else if (encoding === 'deflate') {
          stream = res.pipe(zlib.createInflate());
        }

        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => {
          const buffer = Buffer.concat(chunks);
          
          // Detect charset from headers or HTML meta
          const contentType = res.headers['content-type'] || '';
          let isGbk = /charset=(?:gbk|gb2312|gb18030)/i.test(contentType);
          
          if (!isGbk && buffer.length > 0) {
            const preview = buffer.slice(0, 1024).toString('ascii');
            if (/charset=["']?(?:gbk|gb2312|gb18030)/i.test(preview)) {
              isGbk = true;
            }
          }

          let text = '';
          if (isGbk) {
            try {
              text = new TextDecoder('gbk').decode(buffer);
            } catch (e) {
              text = new TextDecoder('gb18030').decode(buffer);
            }
          } else {
            try {
              text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
            } catch (e) {
              // Automatic fallback to GBK for mainland sites that don't declare charset in header
              try {
                text = new TextDecoder('gbk').decode(buffer);
              } catch (err2) {
                text = buffer.toString('utf-8');
              }
            }
          }

          resolve({ status: res.statusCode, text, headers: res.headers });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Clean HTML into readable text
function cleanHtmlText(html) {
  if (!html) return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Online Novel Sources Scrapers & Search Proxy (支援繁體搜尋自動轉簡體檢索大陸免費源)
async function searchOnlineNovels(keyword) {
  const results = [];
  const simplifiedKw = ChineseConv.t2s(keyword);
  const keywordsToTry = [simplifiedKw];
  if (simplifiedKw !== keyword) {
    keywordsToTry.push(keyword);
  }

  const seenIds = new Set();

  for (const kw of keywordsToTry) {
    const encodedKw = encodeURIComponent(kw);
    // Source 1: 新筆趣閣 (即時可連線高速源)
    try {
      const searchUrl = `https://www.biquge7.xyz/search?keyword=${encodedKw}`;
      const res = await fetchUrl(searchUrl, 5000);
      if (res.status === 200 && res.text) {
        const itemRegex = /<div class="tui_1_item">([\s\S]*?)<\/div>\s*<\/div>/gi;
        let match;
        while ((match = itemRegex.exec(res.text)) !== null) {
          const block = match[1];
          const linkMatch = /<a[^>]+href="(\/\d+)"[^>]*title="([^"]+)"/i.exec(block);
          const authorMatch = /<span class="author">([^<]+)<\/span>/i.exec(block);
          const coverMatch = /<img[^>]+src="([^"]+)"/i.exec(block);

          if (linkMatch) {
            const bookId = 'bqg7_' + linkMatch[1].replace(/\//g, '');
            if (!seenIds.has(bookId)) {
              seenIds.add(bookId);
              results.push({
                id: bookId,
                title: linkMatch[2].trim(),
                author: authorMatch ? authorMatch[1].trim() : '網絡作家',
                intro: `《${linkMatch[2].trim()}》全本免費有聲小說在線播講閱讀`,
                cover: coverMatch ? coverMatch[1] : '',
                source: '新筆趣閣 (高速在線源)',
                detailUrl: `https://www.biquge7.top${linkMatch[1]}`,
                category: '網絡小說'
              });
            }
          }
        }
      }
    } catch (err) {
      // ignore
    }

    if (results.length > 0) break;
  }

  return results;
}

// Scrape Book Chapter List
async function getBookCatalog(bookUrl) {
  try {
    const res = await fetchUrl(bookUrl, 6000);
    if (res.status === 403 || (res.text && (res.text.includes('challenges.cloudflare.com') || res.text.includes('Just a moment') || res.text.includes('cf-mitigated')))) {
      throw new Error('目標網站啟用了 Cloudflare 人機驗證防護 (HTTP 403)，請直接輸入小說書名進行免驗證全網檢索');
    }
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

    const chapters = [];
    const html = res.text;

    // Extract title, author, description, cover
    const titleMatch = /<h1>([^<]+)<\/h1>/i.exec(html) || /<meta property="og:title" content="([^"]+)"/i.exec(html);
    const authorMatch = /<meta property="og:novel:author" content="([^"]+)"/i.exec(html) || /<span class="author">([^<]+)<\/span>/i.exec(html) || /作者[：:]([^<]+)/i.exec(html);
    const introMatch = /<meta property="og:description" content="([^"]+)"/i.exec(html) || /<div class="intro"[^>]*>([\s\S]*?)<\/div>/i.exec(html) || /<div id="intro"[^>]*>([\s\S]*?)<\/div>/i.exec(html);

    // Extract chapters: matches .html or /\d+/\d+ (biquge7 format)
    const chapterRegex = /<a[^>]+href="([^"]+(?:\.html|\/\d+\/\d+))"[^>]*>([^<]+)<\/a>/gi;
    let match;
    const seenUrls = new Set();

    while ((match = chapterRegex.exec(html)) !== null) {
      const relHref = match[1];
      const title = match[2].trim();
      
      // Filter out navigation or invalid links
      if (title.length < 2 || title.includes('筆趣閣') || title.includes('首頁') || title.includes('留言') || title.includes('开始阅读') || title.includes('章节列表')) continue;
      
      let fullUrl = relHref;
      if (!fullUrl.startsWith('http')) {
        const base = new URL(bookUrl);
        fullUrl = new URL(relHref, base).href;
      }

      if (!seenUrls.has(fullUrl)) {
        seenUrls.add(fullUrl);
        chapters.push({
          title,
          url: fullUrl
        });
      }
    }

    // Special handling for Fanqie Novel (番茄小說) - 全本全章節目錄自動解析
    if (bookUrl.includes('fanqienovel.com')) {
      let bookId = null;
      let targetItemId = null;

      const pageIdMatch = bookUrl.match(/\/page\/(\d+)/);
      const readerIdMatch = bookUrl.match(/\/reader\/(\d+)/);

      if (pageIdMatch) {
        bookId = pageIdMatch[1];
      } else if (readerIdMatch) {
        targetItemId = readerIdMatch[1];
      }

      // If bookId is not in URL, extract from reader page __INITIAL_STATE__
      if (!bookId) {
        const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/);
        if (stateMatch) {
          try {
            const stateObj = JSON.parse(stateMatch[1]);
            if (stateObj.reader && stateObj.reader.chapterData) {
              bookId = stateObj.reader.chapterData.bookId || stateObj.reader.chapterData.book_id;
            }
          } catch (e) {}
        }
      }

      // Fetch the full chapter list from Fanqie book page
      if (bookId) {
        try {
          const bookPageUrl = `https://fanqienovel.com/page/${bookId}`;
          let bookPageHtml = html;
          if (!bookUrl.includes(`/page/${bookId}`)) {
            const pRes = await fetchUrl(bookPageUrl, 8000);
            if (pRes.status === 200 && pRes.text) {
              bookPageHtml = pRes.text;
            }
          }

          const pageStateMatch = bookPageHtml.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/);
          if (pageStateMatch) {
            const pageState = JSON.parse(pageStateMatch[1]);
            const pData = pageState.page || {};
            const rawChapters = (pData.chapterListWithVolume || []).flat();

            if (rawChapters.length > 0) {
              const fullChapters = rawChapters.map(c => ({
                title: c.title.trim(),
                url: `https://fanqienovel.com/reader/${c.itemId}`,
                itemId: c.itemId
              }));

              let initialIndex = 0;
              if (targetItemId) {
                const foundIdx = fullChapters.findIndex(c => String(c.itemId) === String(targetItemId));
                if (foundIdx !== -1) initialIndex = foundIdx;
              }

              return {
                title: pData.bookName || '番茄小說',
                author: pData.author || pData.authorName || (authorMatch ? authorMatch[1].trim() : '番茄作家'),
                intro: pData.abstract || pData.description || `《${pData.bookName}》番茄小說正版免費閱讀，全本共 ${fullChapters.length} 章。`,
                cover: pData.thumbUrl || '',
                initialIndex: initialIndex,
                chapters: fullChapters
              };
            }
          }
        } catch (err) {
          console.error('Fetch full fanqie catalog error:', err);
        }
      }

      // Fallback: single chapter if bookId failed
      const pageTitle = (/<title>([^<]+)<\/title>/i.exec(html) || [])[1] || '';
      let bookTitle = '番茄小說';
      let chapterTitle = '正文';
      const titleParts = pageTitle.match(/^(.+?)(第\d+章[^\-_|在线]*)/i);
      if (titleParts) {
        bookTitle = titleParts[1].trim();
        chapterTitle = titleParts[2].trim();
      }

      return {
        title: bookTitle,
        author: authorMatch ? authorMatch[1].trim() : '番茄簽約作家',
        intro: `《${bookTitle}》番茄小說正版免費閱讀`,
        chapters: [
          {
            title: chapterTitle,
            url: bookUrl
          }
        ]
      };
    }

    // Fallback 1: Match links containing "第X章" or "Chapter"
    if (chapters.length === 0) {
      const chapterTitleRegex = /<a[^>]+href="([^"]+)"[^>]*>([^<]*(?:第[0-9一二三四五六七八九十百千萬]+[章回卷節篇]|Chapter\s*\d+|序言|引子|尾聲)[^<]*)<\/a>/gi;
      while ((match = chapterTitleRegex.exec(html)) !== null) {
        const relHref = match[1];
        const title = match[2].trim();
        let fullUrl = relHref.startsWith('http') ? relHref : new URL(relHref, bookUrl).href;
        if (!seenUrls.has(fullUrl)) {
          seenUrls.add(fullUrl);
          chapters.push({
            title,
            url: fullUrl
          });
        }
      }
    }

    return {
      title: titleMatch ? titleMatch[1].trim() : '網絡小說',
      author: authorMatch ? authorMatch[1].trim() : '網絡作者',
      intro: introMatch ? cleanHtmlText(introMatch[1]).slice(0, 300) : '網絡免費小說解析',
      chapters: chapters.slice(0, 2500)
    };
  } catch (err) {
    throw new Error('解析該網址失敗: ' + err.message);
  }
}

// Scrape Chapter Content
async function getChapterContent(chapterUrl) {
  if (chapterUrl.startsWith('mock_df')) {
    return {
      title: '第一章 牢獄之災',
      content: `許七安醒來的時候，發現自己身處在一間昏暗潮濕的牢房中。\n\n刺鼻的霉味混合著稻草腐爛的氣息直往鼻孔裡鑽。他揉了揉劇痛欲裂的腦袋，記憶如潮水般湧入腦海。\n\n他本是警校高材生，因公殉職，沒想到一睜眼，竟然重生在了大奉王朝京兆府的死牢裡！\n\n「二叔貪污戶部稅銀十五萬兩……三日後滿門發配邊疆充軍？」\n\n許七安倒吸一口涼氣。這開局簡直是地獄難度！但在警校經受過嚴格刑偵訓練的他，敏銳地察覺到這是一場精心策劃的栽贓嫁禍。\n\n「想讓我許家當替罪羊？先問問我手中的推理之刃！」`
    };
  }
  if (chapterUrl.startsWith('mock_jl')) {
    return {
      title: '第一章 驚蟄',
      content: `小鎮的落魄少年陳平安，穿著草鞋，獨自走在泥濘的青石街巷。\n\n春雷炸響，萬物驚蟄。小鎮上有三十二條巷弄，每一條巷弄裡都藏著不為人知的仙人傳說。\n\n少年肩挑一擔清水，腳步沉穩而堅定。他的身後，背著一把破舊的木剑，眼中倒映著整座浩然天下的萬古星辰。`
    };
  }
  if (chapterUrl.startsWith('mock_xz')) {
    return {
      title: '第一章 白狐兒臉',
      content: `北涼王府的聽潮亭外，湖波粼粼。\n\n劣馬黃酒六千里，歸來依舊是少年。徐鳳年躺在欄杆上，笑吟吟地看著那位容顏絕世、腰懸雙刀的白狐兒臉南宮僕射。\n\n「這江湖很大，走著走著，老頭子走了，老黃也走了。但只要我徐鳳年還在，北涼三十萬鐵騎的脊梁，就永遠不會彎！」`
    };
  }

  // Fanqie Novel PUA font encryption decoding map (362 unicode PUA points mapped to true Chinese chars)
  const FANQIE_FONT_MAP = {
    '58344': 'D', '58345': '在', '58346': '主', '58347': '特', '58348': '家', '58349': '军', '58350': '然', '58351': '表', '58352': '场', '58353': '4',
    '58354': '要', '58355': '只', '58356': 'v', '58357': '和', '58359': '6', '58360': '别', '58361': '还', '58362': 'g', '58363': '现', '58364': '儿',
    '58365': '岁', '58368': '此', '58369': '象', '58370': '月', '58371': '3', '58372': '出', '58373': '战', '58374': '工', '58375': '相', '58376': 'o',
    '58377': '男', '58378': '直', '58379': '失', '58380': '世', '58381': 'F', '58382': '都', '58383': '平', '58384': '文', '58385': '什', '58386': 'V',
    '58387': 'O', '58388': '将', '58389': '真', '58390': 'T', '58391': '那', '58392': '当', '58394': '会', '58395': '立', '58396': '些', '58397': 'u',
    '58398': '是', '58399': '十', '58400': '张', '58401': '学', '58402': '气', '58403': '大', '58404': '爱', '58405': '两', '58406': '命', '58407': '全',
    '58408': '后', '58409': '东', '58410': '性', '58411': '通', '58412': '被', '58413': '1', '58414': '它', '58415': '乐', '58416': '接', '58417': '而',
    '58418': '感', '58419': '车', '58420': '山', '58421': '公', '58422': '了', '58423': '常', '58424': '以', '58425': '何', '58426': '可', '58427': '话',
    '58428': '先', '58429': 'p', '58430': 'i', '58431': '叫', '58432': '轻', '58433': 'M', '58434': '士', '58435': 'w', '58436': '着', '58437': '变',
    '58438': '尔', '58439': '快', '58440': 'l', '58441': '个', '58442': '说', '58443': '少', '58444': '色', '58445': '里', '58446': '安', '58447': '花',
    '58448': '远', '58449': '7', '58450': '难', '58451': '师', '58452': '放', '58453': 't', '58454': '报', '58455': '认', '58456': '面', '58457': '道',
    '58458': 'S', '58460': '克', '58461': '地', '58462': '度', '58463': 'I', '58464': '好', '58465': '机', '58466': 'U', '58467': '民', '58468': '写',
    '58469': '把', '58470': '万', '58471': '同', '58472': '水', '58473': '新', '58474': '没', '58475': '书', '58476': '电', '58477': '吃', '58478': '像',
    '58479': '斯', '58480': '5', '58481': '为', '58482': 'y', '58483': '白', '58484': '几', '58485': '日', '58486': '教', '58487': '看', '58488': '但',
    '58489': '第', '58490': '加', '58491': '候', '58492': '作', '58493': '上', '58494': '拉', '58495': '住', '58496': '有', '58497': '法', '58498': 'r',
    '58499': '事', '58500': '应', '58501': '位', '58502': '利', '58503': '你', '58504': '声', '58505': '身', '58506': '国', '58507': '问', '58508': '马',
    '58509': '女', '58510': '他', '58511': 'Y', '58512': '比', '58513': '父', '58514': 'x', '58515': 'A', '58516': 'H', '58517': 'N', '58518': 's',
    '58519': 'X', '58520': '边', '58521': '美', '58522': '对', '58523': '所', '58524': '金', '58525': '活', '58526': '回', '58527': '意', '58528': '到',
    '58529': 'z', '58530': '从', '58531': 'j', '58532': '知', '58533': '又', '58534': '内', '58535': '因', '58536': '点', '58537': 'Q', '58538': '三',
    '58539': '定', '58540': '8', '58541': 'R', '58542': 'b', '58543': '正', '58544': '或', '58545': '夫', '58546': '向', '58547': '德', '58548': '听',
    '58549': '更', '58551': '得', '58552': '告', '58553': '并', '58554': '本', '58555': 'q', '58556': '过', '58557': '记', '58558': 'L', '58559': '让',
    '58560': '打', '58561': 'f', '58562': '人', '58563': '就', '58564': '者', '58565': '去', '58566': '原', '58567': '满', '58568': '体', '58569': '做',
    '58570': '经', '58571': 'K', '58572': '走', '58573': '如', '58574': '孩', '58575': 'c', '58576': 'G', '58577': '给', '58578': '使', '58579': '物',
    '58581': '最', '58582': '笑', '58583': '部', '58585': '员', '58586': '等', '58587': '受', '58588': 'k', '58589': '行', '58590': '一', '58591': '条',
    '58592': '果', '58593': '动', '58594': '光', '58595': '门', '58596': '头', '58597': '见', '58598': '往', '58599': '自', '58600': '解', '58601': '成',
    '58602': '处', '58603': '天', '58604': '能', '58605': '于', '58606': '名', '58607': '其', '58608': '发', '58609': '总', '58610': '母', '58611': '的',
    '58612': '死', '58613': '手', '58614': '入', '58615': '路', '58616': '进', '58617': '心', '58618': '来', '58619': 'h', '58620': '时', '58621': '力',
    '58622': '多', '58623': '开', '58624': '已', '58625': '许', '58626': 'd', '58627': '至', '58628': '由', '58629': '很', '58630': '界', '58631': 'n',
    '58632': '小', '58633': '与', '58634': 'Z', '58635': '想', '58636': '代', '58637': '么', '58638': '分', '58639': '生', '58640': '口', '58641': '再',
    '58642': '妈', '58643': '望', '58644': '次', '58645': '西', '58646': '风', '58647': '种', '58648': '带', '58649': 'J', '58651': '实', '58652': '情',
    '58653': '才', '58654': '这', '58656': 'E', '58657': '我', '58658': '神', '58659': '格', '58660': '长', '58661': '觉', '58662': '间', '58663': '年',
    '58664': '眼', '58665': '无', '58666': '不', '58667': '亲', '58668': '关', '58669': '结', '58670': '0', '58671': '友', '58672': '信', '58673': '下',
    '58674': '却', '58675': '重', '58676': '己', '58677': '老', '58678': '2', '58679': '音', '58680': '字', '58681': 'm', '58682': '呢', '58683': '明',
    '58684': '之', '58685': '前', '58686': '高', '58687': 'P', '58688': 'B', '58689': '目', '58690': '太', '58691': 'e', '58692': '9', '58693': '起',
    '58694': '稜', '58695': '她', '58696': '也', '58697': 'W', '58698': '用', '58699': '方', '58700': '子', '58701': '英', '58702': '每', '58703': '理',
    '58704': '便', '58705': '四', '58706': '数', '58707': '期', '58708': '中', '58709': 'C', '58710': '外', '58711': '样', '58712': 'a', '58713': '海',
    '58714': '们', '58715': '任'
  };

  function decodeFanqieText(text) {
    if (!text) return '';
    let out = '';
    for (const ch of text) {
      const code = String(ch.charCodeAt(0));
      if (FANQIE_FONT_MAP[code]) {
        out += FANQIE_FONT_MAP[code];
      } else {
        out += ch;
      }
    }
    // Strip any remaining rogue PUA characters (U+E000 - U+F8FF)
    return out.replace(/[\uE000-\uF8FF]/g, '');
  }

  // Fanqie Novel (番茄小說) Chapter & Font Scraper
  if (chapterUrl.includes('fanqienovel.com')) {
    try {
      const res = await fetchUrl(chapterUrl, 8000);
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const html = res.text;

      // Extract font
      const fontFaceCss = (res.headers && res.headers['x-tt-zhal']) || (html.match(/@font-face\s*\{[\s\S]*?\}/i) || [])[0] || null;
      const fontFamilyMatch = fontFaceCss ? /font-family:\s*([A-Za-z0-9_-]+)/i.exec(fontFaceCss) : null;
      const fontFamily = fontFamilyMatch ? fontFamilyMatch[1] : null;

      // Extract title and paragraphs
      let title = '正文章節';
      let content = '';

      const boxMatch = html.match(/<div class="muye-reader-box[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i);
      if (boxMatch) {
        const titleMatch = boxMatch[1].match(/<h1[^>]*>([^<]+)<\/h1>/i);
        if (titleMatch) title = titleMatch[1].trim();

        const pMatches = [...boxMatch[1].matchAll(/<p>([\s\S]*?)<\/p>/gi)];
        const paras = pMatches
          .map(p => cleanHtmlText(p[1]))
          .filter(p => p && p !== '***' && !p.includes('You need to enable JavaScript') && !p.includes('本章字数') && !p.includes('更新时间'));
        content = paras.join('\n\n');
      }

      if (!content) {
        content = cleanHtmlText(html);
      }

      // Fully decode PUA characters to true Chinese characters
      title = decodeFanqieText(title);
      content = decodeFanqieText(content || '章節內容正在加載中...');

      return {
        title,
        content,
        url: chapterUrl,
        fontFace: fontFaceCss,
        fontFamily: fontFamily
      };
    } catch (err) {
      throw new Error('讀取番茄小說失敗: ' + err.message);
    }
  }

  try {
    const res = await fetchUrl(chapterUrl, 6000);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

    const html = res.text;
    
    // Extract title
    const titleMatch = /<h1[^>]*>([^<]+)<\/h1>/i.exec(html) || /<title>([^<]+)<\/title>/i.exec(html);
    let title = titleMatch ? titleMatch[1].replace(/_.*$/, '').trim() : '正文章節';

    // Extract content container (#content, #chaptercontent, .text, etc.)
    let contentHtml = '';
    const contentMatch = /<div class="text"[^>]*>([\s\S]*?)<\/div>/i.exec(html) ||
                         /<div id="(?:content|chaptercontent|articlecontent)"[^>]*>([\s\S]*?)<\/div>/i.exec(html) ||
                         /<div class="(?:content|read-content|txtnav)"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
    
    if (contentMatch) {
      contentHtml = contentMatch[1];
    } else {
      // Fallback: look for largest paragraph block
      contentHtml = html;
    }

    // Clean up ads, site signatures, next page links
    let content = cleanHtmlText(contentHtml);
    content = content
      .replace(/請記住本書首發域名.*$/gim, '')
      .replace(/最新網址.*$/gim, '')
      .replace(/筆趣閣.*$/gim, '')
      .replace(/www\.[a-z0-9]+\.com/gi, '')
      .replace(/一秒記住.*$/gim, '')
      .replace(/本章未完，請點擊下一頁繼續閱讀.*$/gim, '')
      .trim();

    return {
      title,
      content: content || '章節內容正在加載中或已被原站保護...',
      url: chapterUrl
    };
  } catch (err) {
    throw new Error('讀取章節失敗: ' + err.message);
  }
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  // Enable CORS for API
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API 1: Search online novels
  if (pathname === '/api/search') {
    const q = parsedUrl.searchParams.get('q') || '';
    if (!q) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ success: true, results: [] }));
    }

    try {
      const results = await searchOnlineNovels(q);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, query: q, results }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message, results: [] }));
    }
    return;
  }

  // API 2: Get Book Catalog
  if (pathname === '/api/book-catalog') {
    const url = parsedUrl.searchParams.get('url') || '';
    if (!url) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ success: false, error: 'Missing url parameter' }));
    }

    try {
      const catalog = await getBookCatalog(url);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, ...catalog }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // API 3: Get Chapter Content
  if (pathname === '/api/chapter-content') {
    const url = parsedUrl.searchParams.get('url') || '';
    if (!url) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ success: false, error: 'Missing url parameter' }));
    }

    try {
      const data = await getChapterContent(url);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, ...data }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // Static File Serving
  let reqPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(__dirname, reqPath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`📖 微信讀書風 • 墨韻小說閱讀器 (WeRead Novel) 已啟動！`);
    console.log(`======================================================`);
    console.log(`• 本機預覽: http://localhost:${PORT}`);

    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          console.log(`• 手機/同 Wi-Fi 預覽: http://${iface.address}:${PORT}`);
        }
      }
    }
    console.log(`======================================================\n`);
  });
}

module.exports = server;


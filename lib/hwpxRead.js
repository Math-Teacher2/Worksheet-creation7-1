// HWPX(한글 문서) 교과서·지도서 읽기
// - 글자·표·수식(한글 수식 문법)·그림을 문서 순서대로 꺼내 "쪽" 단위로 나눕니다.
// - 쪽 나눔: 한글이 저장해 둔 줄 위치(lineseg)가 위로 되돌아가는 곳·쪽 나누기·구역 시작.
//   줄 위치 정보가 없으면 글자 수(약 1,800자)로 나눕니다.
// - 이미지가 필요 없어 PDF보다 토큰이 훨씬 적고, 수식이 글자로 들어 있어 깨지지 않습니다.
import { unzipSync, strFromU8 } from 'fflate';

export const isHwpx = (f) => !!f && /\.hwpx$/i.test(f.name || '');

// ---------- 아주 작은 XML 파서 (브라우저·Node 공용) ----------
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s) =>
  s.indexOf('&') < 0
    ? s
    : s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
        if (e[0] === '#') {
          const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
          return Number.isFinite(n) ? String.fromCodePoint(n) : m;
        }
        return ENT[e] ?? m;
      });

export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([^\s>/]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[6] !== undefined) {
      if (top !== root) top.children.push(decode(m[6]));
    } else if (m[3]) {
      const name = m[3].replace(/^[\w-]+:/, '');
      if (m[2]) {
        // 닫는 태그
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].name === name) {
            stack.length = i;
            break;
          }
        }
      } else {
        const attrs = {};
        const ar = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
        let a;
        while ((a = ar.exec(m[4]))) attrs[a[1].replace(/^[\w-]+:/, '')] = decode(a[3] ?? a[4] ?? '');
        const el = { name, attrs, children: [] };
        top.children.push(el);
        if (!m[5] && !/\/\s*$/.test(m[4])) stack.push(el);
      }
    }
  }
  return root;
}

const kids = (n, name) => (n && n.children ? n.children.filter((c) => typeof c === 'object' && (!name || c.name === name)) : []);
function find(n, name) {
  if (!n || typeof n !== 'object') return null;
  for (const c of n.children || []) {
    if (typeof c !== 'object') continue;
    if (c.name === name) return c;
    const r = find(c, name);
    if (r) return r;
  }
  return null;
}
const textOf = (n) => (typeof n === 'string' ? n : (n.children || []).map(textOf).join(''));

// 한글 수식 정리: 글꼴 지정(rm·it·bold)과 띄어쓰기 기호(` ~)를 빼서 AI가 읽기 쉽게, 토큰도 줄임
export function tidyEq(src) {
  return String(src || '')
    .replace(/[`~]+/g, ' ')
    .replace(/(^|[^A-Za-z])(?:rm|it|bold)(?![A-Za-z])/g, '$1 ')
    .replace(/(^|[^A-Za-z])(?:rm|bold)(?=[A-Za-z{])/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/\s*([\^_])\s*/g, '$1')
    .replace(/\{\s+/g, '{')
    .replace(/\s+\}/g, '}')
    .trim();
}

// ---------- 문서 열기 ----------
const SKIP = new Set(['header', 'footer', 'pageNum', 'pageHiding', 'colPr', 'secPr', 'fieldBegin', 'fieldEnd', 'bookmark', 'linesegarray', 'pageNumCtrl', 'autoNum', 'newNum', 'indexmark', 'hiddenComment', 'markpenBegin', 'markpenEnd']);
const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' };
const PAGE_CHARS = 1800;

/** bytes(Uint8Array) → { pages:[{page, text, headings, lead, pics:[{id, idx, ref, mime, frac, ok}]}], bin: {ref:{bytes,mime}}, eqCount } */
export function readHwpxBytes(bytes) {
  let zip;
  try {
    zip = unzipSync(bytes);
  } catch (e) {
    throw new Error(`HWPX 파일을 열지 못했습니다(압축 형식이 아님). 한글에서 "다른 이름으로 저장 → HWPX"로 저장한 파일인지 확인해 주세요. (${e.message || e})`);
  }
  const names = Object.keys(zip);
  const sections = names.filter((n) => /^Contents\/section\d+\.xml$/i.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
  if (!sections.length) throw new Error('HWPX 안에서 본문(section)을 찾지 못했습니다. 옛 형식(.hwp)이면 한글에서 HWPX로 다시 저장해 주세요.');

  // 그림 파일 목록 (content.hpf의 manifest)
  const binHref = {};
  const hpf = names.find((n) => /content\.hpf$/i.test(n));
  if (hpf) {
    const man = parseXml(strFromU8(zip[hpf]));
    const walk = (n) => {
      for (const c of kids(n)) {
        if (c.name === 'item' && c.attrs.id && c.attrs.href) binHref[c.attrs.id] = c.attrs.href;
        walk(c);
      }
    };
    walk(man);
  }
  const binOf = (ref) => {
    let href = binHref[ref];
    if (!href || !zip[href]) href = names.find((n) => n.startsWith(`BinData/${ref}.`) || n === `BinData/${ref}`);
    if (!href || !zip[href]) return null;
    const ext = (href.split('.').pop() || '').toLowerCase();
    return { bytes: zip[href], mime: IMG_MIME[ext] || '', ext };
  };

  // 글자 크기·스타일 이름 (제목 찾기용)
  const charH = {};
  const styleName = {};
  const headName = names.find((n) => /^Contents\/header\.xml$/i.test(n));
  if (headName) {
    const h = parseXml(strFromU8(zip[headName]));
    const walk = (n) => {
      for (const c of kids(n)) {
        if (c.name === 'charPr' && c.attrs.id != null) charH[c.attrs.id] = Number(c.attrs.height) || 1000;
        else if (c.name === 'style' && c.attrs.id != null) styleName[c.attrs.id] = `${c.attrs.name || ''} ${c.attrs.engName || ''}`;
        walk(c);
      }
    };
    walk(h);
  }

  const pages = [];
  const bin = {};
  let eqCount = 0;
  let cur = null;
  const newPage = () => {
    cur = { page: pages.length + 1, parts: [], paras: [], pics: [] };
    pages.push(cur);
  };
  let textW = 42520; // A4 기본 본문 폭(HWPUNIT)
  let pageW = 59528;

  // 노드 → 글자 (그림·수식·표 표시 포함)
  const render = (n) => {
    if (typeof n === 'string') return '';
    switch (n.name) {
      case 't':
        return (n.children || [])
          .map((c) => (typeof c === 'string' ? c : c.name === 'tab' ? '\t' : c.name === 'lineBreak' ? '\n' : c.name === 'nbSpace' || c.name === 'fwSpace' ? ' ' : ''))
          .join('');
      case 'equation': {
        const sc = find(n, 'script');
        const s = sc ? tidyEq(textOf(sc)) : '';
        if (!s) return '';
        eqCount++;
        return `[수식: ${s}]`;
      }
      case 'pic': {
        const img = find(n, 'img');
        const ref = img?.attrs.binaryItemIDRef;
        if (!ref) return '';
        const b = binOf(ref);
        const sz = find(n, 'curSz') || find(n, 'sz') || find(n, 'orgSz');
        const w = Number(sz?.attrs.width) || 0;
        const ok = !!(b && b.mime && b.mime !== 'image/svg+xml');
        if (b) bin[ref] = b;
        const frac = w ? Math.min(1, w / pageW) : 0.5;
        // 쪽 전체 크기의 "글 뒤로" 그림 = 교과서 쪽 배경(그래프·삽화가 그려져 있고 글자는 빠져 있음)
        if (ok && frac >= 0.85 && (n.attrs.textWrap === 'BEHIND_TEXT' || frac >= 0.97)) {
          if (!cur.bg || frac > cur.bg.frac) cur.bg = { ref, mime: b.mime, frac };
          return '';
        }
        const idx = cur.pics.length;
        const id = `H${cur.page}-${idx + 1}`;
        cur.pics.push({ id, idx, ref, mime: b?.mime || '', frac: w ? Math.min(1, w / textW) : 0.5, ok });
        return ok ? `[그림 ${id}]` : '[그림(표시할 수 없는 형식)]';
      }
      case 'tbl': {
        const rows = kids(n, 'tr').map((tr) =>
          kids(tr, 'tc')
            .map((tc) => {
              const sub = find(tc, 'subList') || tc;
              return kids(sub, 'p')
                .map((p) => renderPara(p).trim())
                .filter(Boolean)
                .join(' / ');
            })
            .join(' | ')
        );
        return `\n[표]\n${rows.join('\n')}\n[/표]\n`;
      }
      case 'p':
        return `${renderPara(n)}\n`;
      default:
        if (SKIP.has(n.name)) return '';
        return (n.children || []).map(render).join('');
    }
  };
  // 문단마다 글자 크기 기록(글상자 안 문단 포함) → 큰 글씨 = 제목
  const renderPara = (p) => {
    let size = 0;
    let own = '';
    for (const r of kids(p, 'run')) {
      const t = kids(r, 't').map(textOf).join('');
      if (t.trim()) {
        own += t;
        size = Math.max(size, charH[r.attrs.charPrIDRef] || 0);
      }
    }
    own = own.replace(/\s+/g, ' ').trim();
    if (own && cur) cur.paras.push({ s: own, size, style: styleName[p.attrs.styleIDRef] || '' });
    return (p.children || []).map(render).join('');
  };

  for (const sec of sections) {
    const tree = parseXml(strFromU8(zip[sec]));
    const secEl = kids(tree)[0];
    if (!secEl) continue;
    // 본문 폭
    const pp = find(secEl, 'pagePr');
    if (pp) {
      const mg = find(pp, 'margin');
      const num = (v, d) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
      const W = num(pp.attrs.width, 59528);
      const L = num(mg?.attrs.left, 8504);
      const R = num(mg?.attrs.right, 8504);
      pageW = W;
      if (W - L - R > 1000) textW = W - L - R;
    }
    newPage(); // 구역마다 새 쪽
    let lastV = -1;
    let lastH = 0;
    let breakAfter = false;
    for (const p of kids(secEl, 'p')) {
      const segs = kids(kids(p, 'linesegarray')[0], 'lineseg');
      const v0 = segs.length ? Number(segs[0].attrs.vertpos) : NaN;
      const h0 = segs.length ? Number(segs[0].attrs.horzpos) || 0 : 0;
      const hasContent = cur.parts.length > 0;
      let brk = breakAfter || p.attrs.pageBreak === '1';
      // 줄 위치가 위로 되돌아가면 새 쪽 (오른쪽 단으로 넘어간 경우는 제외)
      if (!brk && hasContent && Number.isFinite(v0) && lastV >= 0 && v0 < lastV - 1000 && h0 <= lastH + 500) brk = true;
      if (brk && hasContent) newPage();
      breakAfter = false;
      if (segs.length) {
        for (let i = 1; i < segs.length; i++) {
          const v = Number(segs[i].attrs.vertpos);
          const hz = Number(segs[i].attrs.horzpos) || 0;
          if (Number.isFinite(v) && v < Number(segs[i - 1].attrs.vertpos) - 1000 && hz <= (Number(segs[i - 1].attrs.horzpos) || 0) + 500) breakAfter = true;
        }
        lastV = Number(segs[segs.length - 1].attrs.vertpos);
        lastH = Number(segs[segs.length - 1].attrs.horzpos) || 0;
      }
      const picStart = cur.pics.length;
      let txt = `${renderPara(p)}\n`.replace(/[ \t]+\n/g, '\n');
      if (!txt.trim()) continue;
      // 줄 위치 정보가 없으면 글자 수로 쪽 나눔 (이 문단의 그림도 새 쪽으로 옮김)
      if (!segs.length && hasContent && cur.parts.join('').length + txt.length > PAGE_CHARS) {
        const moved = cur.pics.splice(picStart);
        newPage();
        moved.forEach((pc, i) => {
          const id = `H${cur.page}-${i + 1}`;
          txt = txt.split(`[그림 ${pc.id}]`).join(`[그림 ${id}]`);
          cur.pics.push({ ...pc, idx: i, id });
        });
      }
      cur.parts.push(txt);
    }
  }

  // 빈 쪽 제거·번호 다시
  const kept = pages.filter((pg) => pg.parts.join('').trim() || pg.pics.length || pg.bg);
  const sizes = kept.flatMap((pg) => pg.paras.map((x) => x.size).filter(Boolean)).sort((a, b) => a - b);
  const med = sizes[sizes.length >> 1] || 1000;
  const out = kept.map((pg, i) => {
    const page = i + 1;
    // 쪽 번호가 바뀌면 그림 번호(H쪽-n)도 맞춤
    const pics = pg.pics.map((pc) => ({ ...pc, id: `H${page}-${pc.idx + 1}` }));
    let text = pg.parts.join('').replace(/[ \t]{3,}/g, '  ').replace(/\n{3,}/g, '\n\n').trim();
    if (page !== pg.page) text = text.replace(/\[그림 H\d+-(\d+)\]/g, (_, n) => `[그림 H${page}-${n}]`);
    const heads = [];
    for (const x of pg.paras) {
      if (!x.s || x.s.length > 60 || !/[가-힣A-Za-z]{2}/.test(x.s)) continue;
      if ((x.size && x.size >= med * 1.3) || /제목|개요|heading|title/i.test(x.style)) if (!heads.includes(x.s)) heads.push(x.s);
    }
    return {
      page,
      text,
      headings: heads.join(' / ').slice(0, 90),
      lead: text.replace(/\[수식: [^\]]*\]/g, '(수식)').replace(/\[그림[^\]]*\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120),
      pics,
      bg: pg.bg || null,
    };
  });
  return { pages: out, bin, eqCount };
}

// ---------- 브라우저: 파일 → 문서 (캐시) ----------
const cache = new WeakMap();
export async function openHwpx(file) {
  if (cache.has(file)) return cache.get(file);
  const p = (async () => readHwpxBytes(new Uint8Array(await file.arrayBuffer())))();
  cache.set(file, p);
  try {
    return await p;
  } catch (e) {
    cache.delete(file);
    throw e;
  }
}

// 그림 상자 표시: 문서 안 그림(H쪽-n)은 쪽 안 위치가 없어서 상자에 그림 순번을 담아 둠
// (x가 100.25~900.25인 상자 = 문서 안 그림. 배경에서 찾은 그림은 실제 위치 상자)
export const picBox = (idx) => [idx * 20 + 10.25, 100.25, idx * 20 + 20.25, 900.25];
export const isPicBox = (box) => Array.isArray(box) && Math.abs(Number(box[1]) - 100.25) < 0.01 && Math.abs(Number(box[3]) - 900.25) < 0.01;
export const picIndexOfBox = (box) => Math.max(0, Math.round(((Array.isArray(box) ? Number(box[0]) : 10.25) - 10.25) / 20));

// 그림 → canvas (bmp·gif 등도 png로 통일, 너비 제한)
async function picCanvas(b, maxW, exactW = 0) {
  const blob = new Blob([b.bytes], { type: b.mime });
  const bmp = await createImageBitmap(blob);
  const scale = exactW ? exactW / bmp.width : Math.min(1, maxW / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

export async function hwpxPageCount(file) {
  return (await openHwpx(file)).pages.length;
}

export async function hwpxOutline(file, pageNo) {
  const d = await openHwpx(file);
  const pg = d.pages[pageNo - 1];
  return pg ? { page: pageNo, headings: pg.headings, lead: pg.lead } : { page: pageNo, headings: '', lead: '' };
}

// 쪽 배경 그림(글자 없이 그래프·삽화만 있는 쪽 그림)을 지정 너비로. 없으면 null
const bgCache = new WeakMap();
export async function hwpxBgCanvas(file, pageNo, width) {
  const d = await openHwpx(file);
  const bg = d.pages[pageNo - 1]?.bg;
  if (!bg) return null;
  if (!bgCache.has(file)) bgCache.set(file, new Map());
  const m = bgCache.get(file);
  const k = `${pageNo}|${width}`;
  if (!m.has(k)) {
    if (m.size > 10) m.delete(m.keys().next().value);
    m.set(k, picCanvas(d.bin[bg.ref], 0, width));
  }
  return m.get(k);
}

const candCache = new WeakMap();
const CAND_W = 900;
/** 그림 후보: 문서 안 그림(H쪽-n) + 쪽 배경에서 찾은 그림 영역(P쪽-n) */
export async function hwpxCands(file, pageNo) {
  if (!candCache.has(file)) candCache.set(file, new Map());
  const cache = candCache.get(file);
  if (cache.has(pageNo)) return cache.get(pageNo);
  const p = (async () => {
    const d = await openHwpx(file);
    const pg = d.pages[pageNo - 1];
    const out = (pg?.pics || []).filter((x) => x.ok && x.frac >= 0.08).map((x) => ({ id: x.id, page: pageNo, box: picBox(x.idx), margin: false, hwpx: true }));
    if (pg?.bg) {
      try {
        const { detectFigures } = await import('./figCandidates');
        const c = await hwpxBgCanvas(file, pageNo, CAND_W);
        const { data } = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
        detectFigures({ data, W: c.width, H: c.height, textRects: [] })
          .slice(0, 10)
          .forEach((f, i) => out.push({ id: `P${pageNo}-${i + 1}`, page: pageNo, box: f.box, margin: !!f.margin }));
      } catch (e) {
        console.warn('HWPX 배경 그림 후보 찾기 실패', pageNo, e);
      }
    }
    return out;
  })();
  cache.set(pageNo, p);
  return p;
}

/** AI에게 보낼 쪽: 글자 + (배경에 그림이 있으면) 배경 이미지 1장 + 문서 안 그림들 */
export async function hwpxForAi(file, pageNo, { picWidth = 640, maxPics = 6 } = {}) {
  const d = await openHwpx(file);
  const pg = d.pages[pageNo - 1] || { text: '', pics: [] };
  const pics = [];
  for (const p of pg.pics.filter((x) => x.ok && x.frac >= 0.12).slice(0, maxPics)) {
    try {
      const c = await picCanvas(d.bin[p.ref], picWidth);
      pics.push({ id: p.id, mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.8).split(',')[1] });
    } catch {
      /* 그림을 못 읽으면 글자만 */
    }
  }
  return { page: pageNo, text: pg.text, cands: await hwpxCands(file, pageNo), pics, hwpx: true, hasBg: !!pg.bg, mime: null, data: null };
}

/** 학습지에 넣을 문서 안 그림 */
export async function hwpxFigure(file, fig) {
  const d = await openHwpx(file);
  const page = Math.min(Math.max(1, fig.page), d.pages.length);
  const okPics = (d.pages[page - 1]?.pics || []).filter((p) => p.ok);
  const idx = picIndexOfBox(fig.box);
  const pic = okPics.find((p) => p.idx === idx) || okPics[0];
  if (!pic) throw new Error(`HWPX ${page}쪽에 그림이 없습니다.`);
  const c = await picCanvas(d.bin[pic.ref], 1100);
  return { id: fig.id, page, box: picBox(pic.idx), desc: fig.desc || '', dataUrl: c.toDataURL('image/png'), w: c.width, h: c.height, frac: Math.max(0.15, Math.min(1, pic.frac || 0.5)) };
}

/** 구성 분석용: 앞 몇 쪽의 글자 */
export async function hwpxText(file, pages) {
  const d = await openHwpx(file);
  return pages
    .filter((p) => p >= 1 && p <= d.pages.length)
    .map((p) => `[${p}쪽]\n${d.pages[p - 1].text}`)
    .join('\n\n');
}

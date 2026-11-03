'use client';

// 파일 올리기: 끌어다 놓거나 [파일 고르기]를 누름. 형식은 accept에 맞는지 확인
import { useRef, useState } from 'react';

const extOf = (name) => (String(name || '').split('.').pop() || '').toLowerCase();

export default function FileDrop({ accept = [], label, hint, file, onFile, inputKey, compact = false, name }) {
  const ref = useRef(null);
  const [over, setOver] = useState(false);
  const [bad, setBad] = useState('');
  const ok = (f) => {
    if (!f) return false;
    const ext = extOf(f.name);
    return accept.some((a) => (a === 'image' ? (f.type || '').startsWith('image/') : a === ext));
  };
  const take = (f) => {
    if (!f) return;
    if (!ok(f) && extOf(f.name) === 'hwp' && accept.includes('hwpx')) {
      setBad(`${f.name}: 옛 한글 형식(.hwp)은 바로 읽을 수 없습니다. 한글에서 [파일 → 다른 이름으로 저장 → 파일 형식: HWPX]로 저장해서 올려 주세요.`);
      return;
    }
    if (!ok(f)) {
      setBad(`${f.name}: 올릴 수 없는 형식입니다. (${accept.map((a) => (a === 'image' ? '이미지' : a.toUpperCase())).join(', ')}만 가능)`);
      return;
    }
    setBad('');
    onFile(f);
  };
  const acceptAttr = accept.map((a) => (a === 'image' ? 'image/*' : a === 'pdf' ? 'application/pdf,.pdf' : `.${a}`)).join(',');
  return (
    <div
      className={`drop ${over ? 'over' : ''} ${file ? 'has' : ''} ${compact ? 'compact' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files?.[0]);
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget || e.target.dataset.pick) ref.current?.click();
      }}
    >
      {file ? (
        <div className="drop-file" data-pick="1">
          <span className="drop-name" data-pick="1">
            {extOf(file.name) === 'hwpx' ? '📄 ' : '📕 '}
            {file.name}
          </span>
          <button type="button" className="mini" onClick={() => ref.current?.click()}>
            다른 파일
          </button>
        </div>
      ) : (
        <>
          <div className="drop-title" data-pick="1">
            {label || '파일을 여기에 끌어다 놓으세요'}
          </div>
          {hint ? (
            <div className="drop-hint" data-pick="1">
              {hint}
            </div>
          ) : null}
          <button type="button" className="ghost drop-btn" onClick={() => ref.current?.click()}>
            파일 고르기
          </button>
        </>
      )}
      {bad ? <div className="drop-bad">{bad}</div> : null}
      <input
        key={inputKey}
        ref={ref}
        name={name}
        type="file"
        accept={acceptAttr}
        style={{ display: 'none' }}
        onChange={(e) => {
          take(e.target.files?.[0] || null);
          e.target.value = '';
        }}
      />
    </div>
  );
}

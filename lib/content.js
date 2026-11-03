// 만들기 설정: AI 생각 깊이, 한 번에 만들 차시 수, 다른 모델 자동 전환, 교과서 이미지 해상도
// (무엇을 넣을지·문항 양은 "내 학습지 구성"에서 정합니다)

export const CONTENT_V = 10;

export const DEFAULT_CONTENT = {
  v: CONTENT_V,
  thinking: 'low', // AI 생각 깊이: low | medium | high
  perChunk: 1, // 한 번에 만들 차시 수
  fallback: true, // 서버가 바쁘면 다른 모델로 자동 전환
  imageRes: 'medium', // 교과서 쪽 이미지: medium(보통) | high(높음)
};

export const THINK_LABEL = { low: '빠르게(권장)', medium: '보통', high: '깊게' };
export const RES_LABEL = { medium: '보통 (권장, 토큰 절약)', high: '높음 (작은 수식·첨자가 많은 교과서)' };

// 이미지 너비(px): 보통은 제공사 기본 너비의 80%
export const resWidth = (base, res) => (res === 'high' ? base : Math.round((base * 0.8) / 10) * 10);

export function normalizeContent(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_CONTENT;
  // v10 이전 저장값: 생각 깊이는 새 기본값(빠르게)으로
  const old = s.v !== CONTENT_V;
  return {
    v: CONTENT_V,
    thinking: !old && ['low', 'medium', 'high'].includes(s.thinking) ? s.thinking : d.thinking,
    perChunk: [1, 2, 3].includes(Number(s.perChunk)) ? Number(s.perChunk) : d.perChunk,
    fallback: typeof s.fallback === 'boolean' ? s.fallback : d.fallback,
    imageRes: ['medium', 'high'].includes(s.imageRes) ? s.imageRes : d.imageRes,
  };
}

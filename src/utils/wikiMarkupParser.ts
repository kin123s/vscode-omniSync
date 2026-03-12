/**
 * Wiki Markup → Plain Text 변환기
 *
 * Jira Server/Data Center의 v2 REST API는 description 필드를
 * Atlassian Wiki Markup 문자열로 반환한다. 이 모듈은 Wiki Markup을
 * 사람이 읽을 수 있는 Plain Text로 변환한다.
 *
 * 지원하는 Wiki Markup 요소:
 *   - 헤딩: h1. ~ h6.
 *   - 볼드: *text*
 *   - 이탤릭: _text_
 *   - 취소선: -text-
 *   - 인라인 코드: {{text}}
 *   - 링크: [text|url] 또는 [url]
 *   - 코드 블록: {code}...{code}, {code:lang}...{code}
 *   - noformat: {noformat}...{noformat}
 *   - 인용: {quote}...{quote}
 *   - 패널: {panel}...{panel}
 *   - 리스트: *, **, #, ##
 *   - 테이블: ||header||header|| / |cell|cell|
 *   - 이미지: !image.png! → [이미지: image.png]
 *   - 색상/기타 매크로: {color}...{color}
 *
 * @module utils/wikiMarkupParser
 */

// ─── 블록 레벨 패턴 ───

/** {code} 또는 {code:language} 블록 → 코드 내용 추출 */
const CODE_BLOCK_RE = /\{code(?::([^}]*))?\}([\s\S]*?)\{code\}/g;

/** {noformat} 블록 → 그대로 유지 */
const NOFORMAT_BLOCK_RE = /\{noformat\}([\s\S]*?)\{noformat\}/g;

/** {quote} 블록 → 인용 텍스트 추출 */
const QUOTE_BLOCK_RE = /\{quote\}([\s\S]*?)\{quote\}/g;

/** {panel} 블록 → 패널 내용 추출 (title 옵션 포함) */
const PANEL_BLOCK_RE = /\{panel(?::([^}]*))?\}([\s\S]*?)\{panel\}/g;

/** {color} 매크로 → 내용만 추출 */
const COLOR_MACRO_RE = /\{color(?::[^}]*)?\}([\s\S]*?)\{color\}/g;

// ─── 인라인 패턴 ───

/** 헤딩: h1. ~ h6. (줄 시작) */
const HEADING_RE = /^h([1-6])\.\s+(.+)$/gm;

/** 볼드: *text* (단어 경계 인식) */
const BOLD_RE = /(?<!\w)\*([^*\n]+?)\*(?!\w)/g;

/** 이탤릭: _text_ (단어 경계 인식) */
const ITALIC_RE = /(?<!\w)_([^_\n]+?)_(?!\w)/g;

/** 취소선: -text- (단어 경계 인식) */
const STRIKETHROUGH_RE = /(?<!\w)-([^-\n]+?)-(?!\w)/g;

/** 인라인 코드: {{text}} */
const INLINE_CODE_RE = /\{\{([^}]+?)\}\}/g;

/** 링크: [text|url] 또는 [url] */
const LINK_WITH_TEXT_RE = /\[([^|[\]]+)\|([^\]]+)\]/g;
const LINK_PLAIN_RE = /\[([^\]|]+)\]/g;

/** 이미지: !image.png! 또는 !image.png|thumbnail! */
const IMAGE_RE = /!([^!\s|]+)(?:\|[^!]*)?\!/g;

/** 수평선: ---- */
const HR_RE = /^-{4,}$/gm;

/**
 * Jira Wiki Markup 문자열을 Plain Text로 변환한다.
 *
 * @param wikiMarkup - Jira Wiki Markup 원본 문자열
 * @returns 변환된 Plain Text. null/undefined 입력 시 빈 문자열 반환.
 */
export function wikiMarkupToPlainText(wikiMarkup: string | null | undefined): string {
    if (!wikiMarkup) { return ''; }

    let text = wikiMarkup;

    // 1) 블록 레벨 매크로 처리 (순서 중요: 블록 → 인라인)

    // {code:lang}...{code} → 코드 내용만 추출
    text = text.replace(CODE_BLOCK_RE, (_match, lang: string | undefined, content: string) => {
        const label = lang ? `[코드: ${lang}]` : '[코드]';
        return `\n${label}\n${content.trim()}\n`;
    });

    // {noformat}...{noformat} → 그대로 유지
    text = text.replace(NOFORMAT_BLOCK_RE, (_match, content: string) => {
        return `\n${content.trim()}\n`;
    });

    // {quote}...{quote} → > 인용 형태
    text = text.replace(QUOTE_BLOCK_RE, (_match, content: string) => {
        const lines = content.trim().split('\n');
        return '\n' + lines.map(line => `> ${line}`).join('\n') + '\n';
    });

    // {panel:title=...}...{panel} → 패널 내용 추출
    text = text.replace(PANEL_BLOCK_RE, (_match, opts: string | undefined, content: string) => {
        let title = '';
        if (opts) {
            const titleMatch = opts.match(/title=([^|]+)/);
            if (titleMatch) { title = `[${titleMatch[1].trim()}] `; }
        }
        return `\n${title}${content.trim()}\n`;
    });

    // {color}...{color} → 내용만
    text = text.replace(COLOR_MACRO_RE, '$1');

    // 2) 인라인 변환

    // 헤딩: h1. Title → Title
    text = text.replace(HEADING_RE, (_match, _level: string, content: string) => content);

    // 인라인 코드: {{code}} → code
    text = text.replace(INLINE_CODE_RE, '$1');

    // 링크: [text|url] → text (url)
    text = text.replace(LINK_WITH_TEXT_RE, '$1 ($2)');

    // 링크: [url] → url
    text = text.replace(LINK_PLAIN_RE, '$1');

    // 이미지: !file.png! → [이미지: file.png]
    text = text.replace(IMAGE_RE, '[이미지: $1]');

    // 볼드: *text* → text
    text = text.replace(BOLD_RE, '$1');

    // 이탤릭: _text_ → text
    text = text.replace(ITALIC_RE, '$1');

    // 취소선: -text- → text
    text = text.replace(STRIKETHROUGH_RE, '$1');

    // 수평선: ---- → ───
    text = text.replace(HR_RE, '───');

    // 3) 테이블 변환
    text = convertTables(text);

    // 4) 리스트 (간단한 정리: *, **, #, ## 등)
    text = convertLists(text);

    // 5) 정리: 연속 빈 줄 제거
    text = text.replace(/\n{3,}/g, '\n\n');

    return text.trim();
}

/**
 * Wiki Markup 테이블을 텍스트 형태로 변환한다.
 * ||header||header|| → header | header
 * |cell|cell|         → cell | cell
 */
function convertTables(text: string): string {
    const lines = text.split('\n');
    const result: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();

        // 헤더 행: ||col1||col2||
        if (trimmed.startsWith('||') && trimmed.endsWith('||')) {
            const cells = trimmed
                .slice(2, -2)             // 양쪽 || 제거
                .split('||')
                .map(c => c.trim());
            result.push(cells.join(' | '));
            result.push(cells.map(() => '---').join(' | ')); // 구분선
            continue;
        }

        // 데이터 행: |col1|col2|
        if (trimmed.startsWith('|') && trimmed.endsWith('|') && !trimmed.startsWith('||')) {
            const cells = trimmed
                .slice(1, -1)             // 양쪽 | 제거
                .split('|')
                .map(c => c.trim());
            result.push(cells.join(' | '));
            continue;
        }

        result.push(line);
    }

    return result.join('\n');
}

/**
 * Wiki Markup 리스트를 들여쓰기 텍스트로 변환한다.
 * * item    → • item
 * ** item   →   • item
 * # item    → 1. item (순서 있는 목록은 단순히 번호 표시)
 */
function convertLists(text: string): string {
    const lines = text.split('\n');
    const result: string[] = [];
    let orderedCounter = 0;

    for (const line of lines) {
        // 비순서 리스트: *, **, ***
        const unorderedMatch = line.match(/^(\*+)\s+(.+)$/);
        if (unorderedMatch) {
            const depth = unorderedMatch[1].length - 1;
            const indent = '  '.repeat(depth);
            result.push(`${indent}• ${unorderedMatch[2]}`);
            orderedCounter = 0;
            continue;
        }

        // 순서 리스트: #, ##, ###
        const orderedMatch = line.match(/^(#+)\s+(.+)$/);
        if (orderedMatch) {
            const depth = orderedMatch[1].length - 1;
            const indent = '  '.repeat(depth);
            orderedCounter++;
            result.push(`${indent}${orderedCounter}. ${orderedMatch[2]}`);
            continue;
        }

        // 리스트가 아닌 줄이 나오면 카운터 리셋
        orderedCounter = 0;
        result.push(line);
    }

    return result.join('\n');
}

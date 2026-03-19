/**
 * Orx — Mustache 기반 경량 템플릿 엔진.
 *
 * PayloadBuilder가 하드코딩된 마크다운을 조립하는 대신,
 * 외부 `.md` 템플릿 파일에 변수를 주입하여 리포트를 생성합니다.
 */
import Mustache from 'mustache';

export class TemplateEngine {
    /**
     * Mustache 템플릿에 데이터를 주입하여 렌더링합니다.
     *
     * @param template - Mustache 문법을 포함한 템플릿 문자열
     * @param data - 템플릿에 주입할 데이터 객체
     * @param partials - 부분 템플릿 맵 ({{> partial_name}})
     * @returns 렌더링된 문자열
     */
    render(template: string, data: Record<string, unknown>, partials?: Record<string, string>): string {
        return Mustache.render(template, data, partials);
    }
}

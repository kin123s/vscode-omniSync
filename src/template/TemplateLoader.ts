/**
 * Orx — 템플릿 파일 로더.
 *
 * Extension URI 기반으로 `templates/` 디렉토리 내의 `.md` 파일을 읽어옵니다.
 * esbuild 번들 환경에서도 안전하게 동작합니다 (__dirname 미사용).
 */
import * as vscode from 'vscode';

export class TemplateLoader {
    private cache = new Map<string, string>();

    constructor(private readonly extensionUri: vscode.Uri) {}

    /**
     * 템플릿 파일을 로드합니다.
     *
     * @param name - 템플릿 이름 (확장자 제외, 예: 'report.handoff')
     * @returns 템플릿 문자열
     * @throws 파일을 찾을 수 없으면 에러
     */
    async load(name: string): Promise<string> {
        // 캐시 확인
        const cached = this.cache.get(name);
        if (cached) { return cached; }

        const templateUri = vscode.Uri.joinPath(
            this.extensionUri,
            'templates',
            `${name}.md`,
        );

        try {
            const bytes = await vscode.workspace.fs.readFile(templateUri);
            const content = Buffer.from(bytes).toString('utf-8');
            this.cache.set(name, content);
            return content;
        } catch {
            throw new Error(`템플릿 '${name}'을 찾을 수 없습니다: ${templateUri.fsPath}`);
        }
    }

    /**
     * _partials/ 하위의 부분 템플릿들을 일괄 로드합니다.
     *
     * @param names - 부분 템플릿 이름 목록 (예: ['context', 'diff', 'test_results'])
     * @returns {이름: 내용} 맵
     */
    async loadPartials(names: string[]): Promise<Record<string, string>> {
        const partials: Record<string, string> = {};
        for (const name of names) {
            try {
                const uri = vscode.Uri.joinPath(
                    this.extensionUri,
                    'templates',
                    '_partials',
                    `${name}.md`,
                );
                const bytes = await vscode.workspace.fs.readFile(uri);
                partials[name] = Buffer.from(bytes).toString('utf-8');
            } catch {
                // 부분 템플릿이 없으면 빈 문자열로 대체 (옵션 처리)
                partials[name] = '';
            }
        }
        return partials;
    }

    /** 캐시 클리어 */
    clearCache(): void {
        this.cache.clear();
    }
}

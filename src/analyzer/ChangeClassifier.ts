/**
 * Orx — 정규식 기반 변경 분류기.
 *
 * AST 파서 없이 git diff 텍스트에서 변경 유형을 추론합니다.
 * 리포트 품질을 향상시키기 위한 경량 분석 레이어입니다.
 */
export interface ClassificationResult {
    categories: string[];
    filesSummary: string;
}

/** 분류 규칙 정의 */
interface ClassificationRule {
    label: string;
    patterns: RegExp[];
}

const RULES: ClassificationRule[] = [
    {
        label: 'API 변경',
        patterns: [
            /controller/i,
            /router/i,
            /\.route\(/i,
            /app\.(get|post|put|delete|patch)\(/i,
            /\.handler/i,
        ],
    },
    {
        label: '비즈니스 로직 변경',
        patterns: [
            /service/i,
            /useCase/i,
            /\.execute\(/i,
        ],
    },
    {
        label: 'DB / 쿼리 변경',
        patterns: [
            /\b(select|insert|update|delete|alter|create\s+table)\b/i,
            /migration/i,
            /\.query\(/i,
            /prisma/i,
            /knex/i,
        ],
    },
    {
        label: 'UI / 프론트엔드 변경',
        patterns: [
            /\.tsx?$/m,
            /component/i,
            /render\(/i,
            /webview/i,
            /\.css$/m,
        ],
    },
    {
        label: '설정 / 인프라 변경',
        patterns: [
            /package\.json/i,
            /tsconfig/i,
            /docker/i,
            /\.yml$/m,
            /\.env/i,
        ],
    },
    {
        label: '테스트 변경',
        patterns: [
            /\.test\./i,
            /\.spec\./i,
            /jest/i,
            /mocha/i,
            /describe\(/i,
            /it\(/i,
        ],
    },
];

export class ChangeClassifier {
    /**
     * diff 텍스트에서 변경 유형을 분류합니다.
     *
     * @param diff - git diff 출력 전체 텍스트
     * @param stat - git diff --stat 출력 (선택)
     * @returns 분류 결과
     */
    classify(diff: string, stat?: string): ClassificationResult {
        const categories: string[] = [];

        for (const rule of RULES) {
            const matched = rule.patterns.some(pattern => pattern.test(diff));
            if (matched) {
                categories.push(rule.label);
            }
        }

        return {
            categories: categories.length > 0 ? categories : ['기타 변경'],
            filesSummary: stat ?? this.extractFilesSummary(diff),
        };
    }

    /**
     * diff 텍스트에서 파일 경로 요약을 추출합니다.
     */
    private extractFilesSummary(diff: string): string {
        const filePattern = /^diff --git a\/(.+?) b\//gm;
        const files: string[] = [];
        let match: RegExpExecArray | null;

        while ((match = filePattern.exec(diff)) !== null) {
            files.push(match[1]);
        }

        if (files.length === 0) {
            return '변경된 파일 없음';
        }

        return files.map(f => `- ${f}`).join('\n');
    }
}
